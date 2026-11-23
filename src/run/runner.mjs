// `evals run`: one isolated OpenCode run per (case, trial), recorded where `evals trace` reads it.
//
//   $EVALS_STORE/raw/<iteration>/<plugin>/<case>.t<k>.jsonl          `opencode run --format json`, as it printed it
//   $EVALS_STORE/raw/<iteration>/<plugin>/<case>.t<k>.summary.json   exit, time, trial, model, host, runner, provenance
//   $EVALS_STORE/raw/<iteration>/<plugin>/batch-<id>.json            the plan and what happened to each run
//
// Before anything launches: the cases are selected, the build is copied, the world is checked (and rebuilt with the
// build under test when it is stale), the credential is prepared, the dollar budget is checked and the whole batch is
// reserved against the run caps. A batch that does not fit runs nothing. Every trial has its own sandbox, its own
// server on a free port and its own file; an existing recording is never overwritten.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { freePort } from "../t1/http.mjs"
import { stockBinary, TESTED } from "../t1/harness.mjs"
import { selectCases } from "../case/sets.mjs"
import { pluginCases } from "../case/load.mjs"
import { harnessVersion } from "../version.mjs"
import { reserve, release, recordRun, readLedger, loadCaps, checkCaps, monthOf, outstanding, capsFile } from "../cost/ledger.mjs"
import { isMetered, assertBatchWithinBudget, projectedRunUsd, monthToDate, budgetCaps, assertLaunchWithinRound, estimateRunUsd, roundLimits, tierOf, RoundCapError } from "../cost/budget.mjs"
import { loadCatalog, loadMapping, resolve as resolvePrice, listPrice } from "../cost/catalog.mjs"
import { pluginRepo } from "../pack/from-plugin.mjs"
import { rawRoot, storeRoot } from "../store.mjs"
import { makeSandbox, sealedConfig, sandboxEnv, worldEnv, newPassword, writeConfig, start, runToEnd, stop, removeSandbox, removeInside, killAll, stripForeignLinks, SCRIPTED_MODEL } from "./sandbox.mjs"
import { parseAuth, prepareAuth, readCredential, unknownExpiry } from "./auth.mjs"
import { loadWorld, parseSeed, parseSeedList } from "./world.mjs"
import { checkTruth, renderTruthProblem } from "../case/truth.mjs"
import { AUTH_ERROR, endedOnAuth } from "./authError.mjs"
import { materialiseArm, armProvenance, readCompanions, materialiseCompanions, companionsDigest } from "./arm.mjs"
import { lockdownPolicies, lockdownPermissions, loadPacks, companionOptions, ACCESS } from "./lockdown.mjs"
import { buildPolicy, installGuard } from "./guard/policy.mjs"
import { gateCases, seedFiles, dataPreflight, loadDataMatrix } from "./gate.mjs"
import { resolveCommitPlan } from "./commit-plan.mjs"
import { noAccountPlugins, fakePlugins, noCredentialPlugins, noProfilePlugins, pluginsOf } from "./accounts.mjs"
import { FAKE_HOSTS, fakeFor, hostsFor, installFake } from "./fake-mode.mjs"
import { haltReason, readHalt, writeHalt, haltMessage } from "./halt.mjs"
import { integrationsFor } from "./vendor-auth.mjs"
import { checkBalances, vendorUseOf, SPENDING, perRunWorst } from "./balance.mjs"
import { summarize } from "../trace/analyse.mjs"
import { loadTargets, loadCanaries } from "../grade/targets.mjs"
import { batchEgress } from "./egress.mjs"
import { snapshotFiles, changedFiles, snapshotHome, changedHome, homeLinks } from "./files.mjs"
import { segment, within, inside } from "./paths.mjs"
import { selectIsolation, isLive, defaultIsolation, containerContained } from "./isolation.mjs"
import { ownedSession } from "./owned-launch.mjs"
import { containerConfig, findBinary, markBatchDir } from "./container.mjs"
import { redactor, scrubTree, registerSecrets, tail } from "./secrets.mjs"
import { splitTrial } from "../grade/trials.mjs"
import { digestOf } from "../util/canonical.mjs"
import { dirname } from "node:path"
import { stageMemFixture, memFixtureOptions, memFixtureBinding, startMemFixture, memCaptureRecord } from "./mem-fixture.mjs"
import { coreCases } from "../../packs/mem/core.mjs"
import { runMemoryTurns,nativeMemoryCalls,withMemoryActivation } from "./mem-turns.mjs"
import { makeCompletionReadClient } from "./native-completion-http.mjs"
import { verifyNativeCompletion } from "./native-completion.mjs"
import {randomUUID} from "node:crypto"
import { selectMemoryPlan } from "./mem-case-plan.mjs"
import { setProcessGroupMode } from "./sandbox.mjs"
import { qualifyConditions, sha256 } from "./wave-manifest.mjs"
import { memoryArtifact } from "./mem-arm.mjs"
import { singleAttemptCost } from "../cost/attempt.mjs"


export const RUNNER = "evals run"

/**
 * What one run costs beyond its own timeout, for the credential's horizon: the world's prepare step, a container's
 * setup and teardown (about a second, measured), the credential import and the server's start (seconds each). Two
 * minutes by default, which covers a slow world prepare; EVALS_RUN_OVERHEAD_S or caps.json's run_overhead_s changes it.
 */
export const DEFAULT_RUN_OVERHEAD_S = 120
export function runOverheadMs(store, env = process.env) {
  const file = capsFile(store, env)
  const fromFile = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")).run_overhead_s : undefined
  const value = env.EVALS_RUN_OVERHEAD_S !== undefined && env.EVALS_RUN_OVERHEAD_S !== "" ? env.EVALS_RUN_OVERHEAD_S : fromFile ?? DEFAULT_RUN_OVERHEAD_S
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error(`the per-run overhead must be a number of seconds, not ${JSON.stringify(value)} (EVALS_RUN_OVERHEAD_S or caps.json run_overhead_s)`)
  return seconds * 1000
}

/** Where a batch's sandboxes go: EVALS_TMP, else /var/tmp/evals (on disk), made private to this user if missing. */
export const DEFAULT_TMP = "/var/tmp/evals"
export function batchTmp(caller = process.env) {
  if (caller.EVALS_TMP) return resolve(caller.EVALS_TMP)
  try {
    mkdirSync(DEFAULT_TMP, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw new Error(`cannot make ${DEFAULT_TMP} (${error.code}): create it once with \`sudo install -d -m 700 -o "$USER" -g "$USER" ${DEFAULT_TMP}\`, or set EVALS_TMP to a directory on disk`)
  }
  return DEFAULT_TMP
}

/** The host binary: a tested stock version, EVALS_OPENCODE_BIN, or `opencode` on PATH. */
export function hostBinary({ host, env = process.env }) {
  if (host) {
    const binary = stockBinary(host, { env })
    if (!binary) throw new Error(`no stock binary for ${host}: set OPENCODE_BIN_${host.replaceAll(".", "_")} or EVALS_STOCK_DIR`)
    return binary
  }
  return env.EVALS_OPENCODE_BIN ?? "opencode"
}


/** The trials already recorded for each case in this iteration. */
function recordedTrials(dir) {
  const trials = new Map()
  if (!existsSync(dir)) return trials
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".jsonl"))) {
    const { case: id, trial } = splitTrial(file.replace(/\.jsonl$/, ""))
    trials.set(id, Math.max(trials.get(id) ?? 0, trial ?? 1))
  }
  return trials
}

/** The jobs, before anything runs: one per (case, trial), numbered after any trial already recorded with --append. */
export function plan({ cases, trials, recorded, append }) {
  const clashes = cases.filter((c) => recorded.has(c.id))
  if (clashes.length && !append) {
    throw new Error(`${clashes.length} case(s) already have recordings in this iteration (${clashes.slice(0, 3).map((c) => c.id).join(", ")}${clashes.length > 3 ? ", …" : ""}): use a new --iteration, or --append to add trials after them`)
  }
  return cases.flatMap((c) => Array.from({ length: trials }, (_, index) => ({ case: c, trial: (append ? recorded.get(c.id) ?? 0 : 0) + index + 1 })))
}

/**
 * Did the run fail because its model call was refused authentication? Only when the model did no work (no tokens)
 * and the host's own error output, or an error event, says so: HTTP 401 or 403 from the provider (a proxy's refusal
 * of a tunnel aside), an authentication or permission error, an expired or invalid token, or the sign-in prompt.
 */
export { AUTH_ERROR, endedOnAuth }
export function authFailed({ stdout = "", stderr = "" } = {}) {
  if (endedOnAuth(stdout)) return true
  const tokens = billedOf(stdout).tokens
  if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0) return false
  const said = [String(stderr)]
  for (const line of String(stdout).split("\n")) {
    if (!line.trim()) continue
    try {
      const event = JSON.parse(line)
      if (event.type === "error" || event.error || event.part?.type === "error") said.push(JSON.stringify(event))
    } catch {
      // a partial line
    }
  }
  return said.some((text) => text.split("\n").some((line) => AUTH_ERROR.test(line) && !/tunnel|proxy/i.test(line)))
}

/**
 * Did the run fail before any model was reached because the host could not route the model to a provider? The
 * runner's own wait gave up (noRoute), or, with no model work done, the host reported a provider error such as
 * `provider.no-route` ("Model unavailable").
 */
const NO_ROUTE = /provider\.no-route|"type":"provider\.|model unavailable|ProviderModelNotFound|model not found/i
export function providerFailed(result = {}) {
  if (result.noRoute) return true
  const { stdout = "", stderr = "" } = result
  const tokens = billedOf(stdout).tokens
  if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0) return false
  const said = [String(stderr)]
  for (const line of String(stdout).split("\n")) {
    try {
      const event = JSON.parse(line)
      if (event.type === "error" || event.error) said.push(JSON.stringify(event))
    } catch {
      // not an event
    }
  }
  return said.some((text) => NO_ROUTE.test(text))
}

/**
 * A run refused for rate (R13): no model work, and an error event or stderr line that says 429, rate limit or overloaded, and is not
 * a refusal of the credential. Never the model's to be graded on, and not an infrastructure failure either: it is tried again after a
 * backoff, and three in a row pause the model.
 */
const RATE_LIMITED = /\b429\b|rate[_ -]?limit|too many requests|overloaded/i
export function rateLimited(result = {}) {
  if (authFailed(result)) return false
  const { stdout = "", stderr = "" } = result
  const tokens = billedOf(stdout).tokens
  if (tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite > 0) return false
  const said = [String(stderr)]
  for (const line of String(stdout).split("\n")) {
    try {
      const event = JSON.parse(line)
      if (event.type === "error" || event.error) said.push(JSON.stringify(event))
    } catch {
      // not an event
    }
  }
  return said.some((text) => RATE_LIMITED.test(text))
}

/**
 * Claude Agent reports `isUsingOverage` on its rate-limit events: true means the run drew on the subscription's overage (paid) use,
 * which the round never buys. Seen in the recording or on stderr, no further trial launches (G0 review 1.3).
 */
export const usingOverage = (result = {}) => /"isUsingOverage"\s*:\s*true/.test(`${result.stdout ?? ""}\n${result.stderr ?? ""}`)

/** The backoff before each retry of a rate-limited run, in seconds, and how long three in a row pause the model. */
export const BACKOFF_S = [60, 120, 240]
export const PAUSE_S = 30 * 60

/**
 * What follows a rate-limited attempt: a retry only with attempts left and the previous trial confirmed gone. A container
 * still there fails the trial as infra `container` instead of retrying beside it on the same host; an exhausted run is
 * `rate-limit`, as before.
 */
export function harnessRetryLimit(value) {
  if (value === undefined) return undefined
  if (!(typeof value === "number" || typeof value === "string" && /^[0-3]$/.test(value)) || !Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > BACKOFF_S.length) throw new Error("--harness-retries must be a retry limit from 0 through 3")
  return Number(value)
}

export function rateLimitOutcome(attempt, gone, limit = BACKOFF_S.length) {
  if (attempt < limit) {
    return gone ? { retry: true } : { retry: false, infra: "container", why: "the trial's container was still there after the rate-limited run, so the trial is not retried" }
  }
  return { retry: false, infra: "rate-limit" }
}

/** "auth", "provider", or null: a failure before the model did any work, which is never the model's to be graded on. */
// A rate limit is neither: it is retried after a backoff (rateLimited above), and the host may name it a provider error.
export const preModelFailure = (result) => (authFailed(result) ? "auth" : rateLimited(result) ? null : providerFailed(result) ? "provider" : null)

/**
 * Waits until `model` is listed by the trial's own server (`opencode models --server`, run inside the trial), or the
 * timeout passes. Returns { ok, waitedMs, listed }.
 */
export async function modelRoutes({ trial, binary, url, env, cwd, model, timeoutMs = 60_000 }) {
  const target = String(model).replace(/#.*$/, "")
  const started = Date.now()
  let listed = []
  for (;;) {
    const spec = trial.wrap({ command: binary, args: ["models", "--server", url], cwd, env })
    const out = await runToEnd(spec.command, spec.args, { cwd: spec.cwd, env: spec.env, timeoutMs: 30_000 })
    listed = out.stdout.split("\n").map((line) => line.trim()).filter((line) => /^[\w.-]+\/\S+$/.test(line))
    if (listed.includes(target)) return { ok: true, waitedMs: Date.now() - started, listed }
    if (Date.now() - started > timeoutMs || trial.killed || trial.left) return { ok: false, waitedMs: Date.now() - started, listed }
    await new Promise((done) => setTimeout(done, 500))
  }
}

/**
 * Before anything is reserved: one trial set up exactly as a run's would be (the isolation, the build under test, the
 * credential imported, the server started), with no prompt sent, checks that the batch's model routes inside it.
 */
async function preflightRoute(p) {
  const sandbox = makeSandbox(join(p.batchRoot, "preflight"))
  mkdirSync(join(sandbox.project, ".git"), { recursive: true })
  const config = sealedConfig({ armDir: p.armDir, options: p.options, model: p.model, scripted: p.scripted, scriptedProvider: p.scriptedProvider, ...p.sealed })
  writeConfig(sandbox, config)
  const password = newPassword()
  registerSecrets([password])
  // Fake mode: the plugins' own vendor hosts are mapped to loopback here too, with nothing listening, so the preflight reaches neither the fake nor the proxy nor the vendor.
  const trial = await p.isolation.enter({ name: "preflight", sandbox, mounts: p.mounts, cwd: sandbox.project, ...(p.fake ? { hosts: hostsFor(p.fake.ids), ca: p.fake.ca } : {}) })
  let server = null
  let mock = null
  try {
    if (p.scripted && p.mockInTrial) mock = await startTrialMock({ trial, ctx: p, sandbox })
    const mockUrl = mock?.url ?? p.mockUrl
    const env = sandboxEnv({ sandbox, config, password, caller: p.caller, extra: { ...p.auth.env, ...(mockUrl ? { SPIKE_MOCK_URL: mockUrl } : {}) } })
    const exec = (args, options = {}) => {
      const spec = trial.wrap({ command: p.binary, args, cwd: options.cwd ?? sandbox.project, env: options.env ?? env, stdin: options.input !== undefined && options.input !== null })
      return runToEnd(spec.command, spec.args, { ...options, cwd: spec.cwd, env: spec.env })
    }
    await p.auth.apply({ sandbox, env, exec })
    server = await startServer({ binary: p.binary, cwd: sandbox.project, env, password, trial })
    await p.auth.verify?.({ sandbox, env, exec, url: server.url })
    return await modelRoutes({ trial, binary: p.binary, url: server.url, env, cwd: sandbox.project, model: p.model, timeoutMs: p.routeTimeoutMs })
  } finally {
    await stop(server?.proc)
    await stop(mock?.proc, { graceMs: 200 })
    await trial.leave({ reason: "preflight" })
    const gone = await trial.gone()
    p.auth.cleanup({ sandbox, gone })
    if (gone) removeSandbox(sandbox.root)
  }
}

const billedOf = (stdout) => {
  let total = 0
  let priced = false
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  for (const line of stdout.split("\n")) {
    if (!line.includes("step_finish")) continue
    try {
      const part = JSON.parse(line).part ?? {}
      if (typeof part.cost === "number") {
        total += part.cost
        if (part.cost > 0) priced = true
      }
      tokens.input += part.tokens?.input ?? 0
      tokens.output += part.tokens?.output ?? 0
      tokens.cacheRead += part.tokens?.cache?.read ?? 0
      tokens.cacheWrite += part.tokens?.cache?.write ?? 0
    } catch {
      // a partial line from a killed run
    }
  }
  // The split counters let a later batch price its runs from the catalogue when nothing billed.
  return { billed_usd: total, cost_source: priced ? "billed" : "unpriced", tokens }
}

/** Opt-in single-attempt evidence: an absent receipt is unknown, never an estimated actual cost. */
export function settleSingleAttempt(store, identity, result = {}, price = null) {
  // Pinned 2.2.6 noninteractive.ts checks native prompt outcomes internally, but does not
  // emit a prompt-terminal JSON record. Step receipts/exit zero cannot replace the absent
  // qualified recorder seal. Keep totals unresolved even when every observed step is priced.
  const cost = singleAttemptCost(result.stdout, price)
  recordRun(store, { ...identity, ...cost })
  return cost
}

/**
 * The run's cost at LIST price: its tokens against the catalogue through the model map, whatever was billed (a subscription
 * bills $0). Null when the catalogue has no price for the model. This is what the round's ceiling counts (R9).
 */
export function listUsdOf(tokens, price) {
  return price ? listPrice(tokens, price) : null
}

/** The catalogue price of the batch's model, resolved once: `{ price, via }` or `{ price: null, why }`. */
export function modelPrice(model, caller) {
  const [provider, ...rest] = String(model ?? "").split("/")
  const resolved = resolvePrice(loadCatalog(caller), provider, rest.join("/"), loadMapping(caller))
  return resolved.price ? { price: resolved.price, via: resolved.via } : { price: null, why: resolved.why }
}

/**
 * What the host logged about plugins and servers in one trial (its own log file under the sandbox's data dir): the plugins
 * that failed to load, with the first line of why, and how many warnings it wrote. A plugin that fails to load registers
 * nothing, silently, so this is where "loaded" is proved.
 */
export function hostLogFacts(home) {
  const file = join(home, ".local", "share", "opencode", "log", "opencode.log")
  if (!existsSync(file)) return { log: false }
  const lines = readFileSync(file, "utf8").split("\n")
  const failed = []
  let warnings = 0
  for (const line of lines) {
    if (!/level=(WARN|ERROR)/.test(line)) continue
    warnings++
    const m = /message="failed to load plugin" plugin\.id=(\S+) cause="([^"]{0,300})/.exec(line)
    if (m) failed.push({ plugin: m[1], why: m[2].replace(/\s+/g, " ") })
  }
  return { log: true, warnings, plugin_load_failures: failed }
}

/** The guard's log lines for one trial (the file is in the trial's tmp, written by the guard plugin inside it). */
function guardRecords(file) {
  if (!existsSync(file)) return []
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => {
    try {
      return JSON.parse(line)
    } catch {
      return null
    }
  }).filter(Boolean)
}

/** What the guard saw, in numbers: asks answered, writes refused, assertion failures (EVALS-ASSERT), and whether it ran. */
export function guardSummary(records) {
  const count = (kind) => records.filter((r) => r.kind === kind).length
  const asserts = records.filter((r) => r.kind === "assert")
  return {
    ran: records.some((r) => r.kind === "guard_start"),
    asks: count("ask"),
    rejected: count("reject"),
    reject_failed: count("reject_failed"),
    asks_left_to_run: records.filter((r) => r.kind === "ask" && r.own === true).length,
    refused_writes: asserts.filter((r) => r.what === "write").length,
    refused_tools: asserts.filter((r) => r.what === "tool").length,
    assert_access: asserts.filter((r) => r.what === "access").length,
    assert_committed: asserts.filter((r) => r.what === "committed").length,
    committed: count("committed"),
    write_calls: records.filter((r) => r.kind === "execute_before" && r.write).length,
  }
}

const writeAtomic = (file, text) => {
  const tmp = `${file}.tmp-${process.pid}`
  writeFileSync(tmp, text, { mode: 0o600 })
  renameSync(tmp, file)
}

/**
 * Starts one host server on a port the trial gives (a free loopback port, or a fixed one inside a container), checks it
 * from wherever the trial's loopback is reachable, and retries on another port when it does not come up.
 */
async function startServer({ binary, cwd, env, password, trial, timeoutMs = 60_000 }) {
  let last = ""
  for (let attempt = 0; attempt < (trial.parentRemovalRequired ? 1 : 3); attempt++) {
    const port = await trial.port(attempt)
    const spec = trial.wrap({ command: binary, args: ["serve", "--hostname", "127.0.0.1", "--port", String(port)], cwd, env })
    const proc = start(spec.command, spec.args, { cwd: spec.cwd, env: spec.env })
    let exited = false
    proc.exited.then(() => (exited = true))
    const up = await trial.ready({ url: `http://127.0.0.1:${port}/api/agent`, password, directory: cwd, timeoutMs, exited: () => exited })
    if (up.ok) return { proc, url: `http://127.0.0.1:${port}`, port }
    last = exited ? `the server exited: ${tail(proc.output().stderr, 300)}` : up.last
    await stop(proc, { graceMs: 500 })
    if (trial.killed) break
  }
  throw new Error(`the host server did not start: ${last}`)
}

/** The scripted model inside a confined trial: T1's mock server on the trial's own loopback. */
const MOCK_PORT = 4200
const TRIAL_MOCK_URL = `http://127.0.0.1:${MOCK_PORT}/v1`
async function startTrialMock({ trial, ctx, sandbox }) {
  const spec = trial.wrap({ command: ctx.bunBinary, args: [join(ctx.harnessDir, "mock", "server.ts"), String(MOCK_PORT), join(sandbox.tmp, "mock.jsonl")], cwd: sandbox.tmp, env: { HOME: sandbox.tmp, TMPDIR: sandbox.tmp, ...(ctx.caller.EVALS_MOCK_USAGE ? { EVALS_MOCK_USAGE: ctx.caller.EVALS_MOCK_USAGE } : {}) } })
  const proc = start(spec.command, spec.args, { cwd: spec.cwd, env: spec.env })
  let exited = false
  proc.exited.then(() => (exited = true))
  const up = await trial.ready({ url: `http://127.0.0.1:${MOCK_PORT}/v1/models`, timeoutMs: 20_000, exited: () => exited })
  if (!up.ok) {
    await stop(proc, { graceMs: 200 })
    throw new Error(`the scripted model did not start in the trial: ${up.last}`)
  }
  return { proc, url: TRIAL_MOCK_URL }
}

/** P0-13's capture server inside the trial: a stand-in for the Anthropic API on the trial's own loopback, logging what `claude` sends. */
const CAPTURE_PORT = 4300
async function startCapture({ trial, ctx, sandbox }) {
  const args = [join(ctx.harnessDir, "capture", "capture-server.ts"), String(CAPTURE_PORT), join(sandbox.tmp, "capture.jsonl")]
  if (ctx.captureServer?.toolUse) args.push(JSON.stringify(ctx.captureServer.toolUse))
  const spec = trial.wrap({ command: ctx.bunBinary, args, cwd: sandbox.tmp, env: { HOME: sandbox.tmp, TMPDIR: sandbox.tmp } })
  const proc = start(spec.command, spec.args, { cwd: spec.cwd, env: spec.env })
  let exited = false
  proc.exited.then(() => (exited = true))
  const up = await trial.ready({ url: `http://127.0.0.1:${CAPTURE_PORT}/v1/models`, timeoutMs: 20_000, exited: () => exited })
  if (!up.ok) {
    await stop(proc, { graceMs: 200 })
    throw new Error(`the capture server did not start in the trial: ${up.last}`)
  }
  return { proc, url: `http://127.0.0.1:${CAPTURE_PORT}` }
}

/** Fake mode's MCP server for one plugin, inside the trial on loopback: the harness's own, serving the pack's tool list and a synthetic fixture. */
async function startFakeMcp({ trial, ctx, sandbox, id, port }) {
  const dir = join(ctx.harnessDir, "fake")
  const { ip } = FAKE_HOSTS[id]
  const leaf = ctx.fake.leaves[id]
  const spec = trial.wrap({ command: ctx.bunBinary, args: [join(dir, "mcp-server.ts"), String(port), join(sandbox.tmp, `fake-${id}.jsonl`), join(dir, `${id}.catalog.json`), join(dir, "fixtures", `${id}.mjs`), ip, leaf.key, leaf.cert], cwd: sandbox.tmp, env: { HOME: sandbox.tmp, TMPDIR: sandbox.tmp } })
  const proc = start(spec.command, spec.args, { cwd: spec.cwd, env: spec.env })
  let exited = false
  proc.exited.then(() => (exited = true))
  const up = await trial.ready({ url: `http://127.0.0.1:${port}/health`, timeoutMs: 20_000, exited: () => exited })
  if (!up.ok) {
    await stop(proc, { graceMs: 200 })
    throw new Error(`the fake ${id} MCP server did not start in the trial: ${up.last}`)
  }
  return { id, proc }
}

/** T1's scripted model server, started for a batch: the harness's own mock, never a model. */
async function startMock({ batchRoot, caller }) {
  const port = await freePort()
  const home = join(batchRoot, "mock")
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const proc = start(caller.EVALS_BUN ?? "bun", [resolve(import.meta.dirname, "..", "t1", "mock", "server.ts"), String(port), join(home, "mock.jsonl")], { cwd: home, env: { PATH: caller.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: home, ...(caller.EVALS_MOCK_USAGE ? { EVALS_MOCK_USAGE: caller.EVALS_MOCK_USAGE } : {}) } })
  const deadline = Date.now() + 15_000
  for (;;) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(1000) })).ok) return { proc, url: `http://127.0.0.1:${port}/v1` }
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) {
      await stop(proc)
      throw new Error("the scripted model did not start (is bun installed, or EVALS_BUN set?)")
    }
    await new Promise((done) => setTimeout(done, 100))
  }
}

/** Removes every sandbox's copy of the sign-in under a batch directory, through no link a run may have planted. */
function scrubCredentials(batchRoot, gone) {
  const runs = join(batchRoot, "runs")
  if (!existsSync(runs)) return
  for (const name of readdirSync(runs)) removeInside(join(runs, name), join(runs, name, "home", ".claude", ".credentials.json"), { gone })
}

/** `Seed: utc-hours=9-15`: a case whose truth depends on the UTC hour runs only inside its window (9 <= h < 15). */
export function hourWindow(seed, at = new Date()) {
  const spec = parseSeed(seed)["utc-hours"]
  if (!spec) return { ok: true }
  const match = /^(\d{1,2})-(\d{1,2})$/.exec(spec)
  if (!match) throw new Error(`Seed utc-hours=${spec}: use <from>-<to>, hours 0-24`)
  const [from, to] = [Number(match[1]), Number(match[2])]
  const hour = at.getUTCHours()
  const inside = from <= to ? hour >= from && hour < to : hour >= from || hour < to
  return inside ? { ok: true, hour } : { ok: false, hour, why: `the case runs between ${from}:00 and ${to}:00 UTC, and it is ${hour}:xx` }
}

/** The selected cases' `Truth:` claims against the world's truth file; null when no case declares one. */
export function truthCheck(cases, world) {
  const claiming = cases.filter((c) => c.truth?.length)
  if (!claiming.length) return null
  const data = typeof world.truth === "function" ? world.truth() : null
  if (!data) throw new Error(`${claiming.length} case(s) declare a Truth: (${claiming.slice(0, 3).map((c) => c.id).join(", ")}) and the world ${world.name} names no truth file (world.json "truth")`)
  return checkTruth(claiming, data)
}

/**
 * The stall watch of a trial's `opencode run`: only a SCRIPTED trial with its mock in the trial has one. A real model's slow first answer is a slow answer, never a hang, so a credentialed
 * run gets none and is never killed for its first request's lateness (review of #13, R3).
 */
export const stallOf = (ctx, sawRequest) => (ctx.scripted && ctx.mockInTrial && ctx.firstRequestMs ? { stall: { afterMs: ctx.firstRequestMs, alive: sawRequest } } : {})

/** The native completion observation's own bound: the verifier's pinned ceiling. A
 * longer turn is still bounded by its own timeout; the observation gives up at this
 * ceiling and says so in its record instead of waiting unbounded. */
const COMPLETION_CEILING_MS = 120_000

/** The complete serial per-trial identity for one observed prompt turn. Every field
 * is a runner-owned fact — the case, the physical trial, the turn's 1-based index,
 * the turn's activation, the trial's incarnation (the parent's bound invocation
 * inside a contained execution, the runner's own otherwise) and the session the
 * existing /api/session contract holds. Nothing here reads native events,
 * transcripts or workload output, and the scope inventory is exactly the trial's
 * own session: complete and serial by construction, never discovered. */
export function completionTurnBinding({ caseID, trialID, turn, activationID, incarnationID, sessionID }) {
  for (const [key, value] of Object.entries({ caseID, trialID, activationID, incarnationID, sessionID })) {
    if (typeof value !== "string" || value.length === 0) throw new Error(`the completion ${key} identity is required`)
  }
  if (!Number.isInteger(turn) || turn < 1) throw new Error("the completion turn index is required")
  return { caseID, trialID, turnID: String(turn), activationID, incarnationID, sessionID,
    scope: { complete: true, serial: true, sessionIDs: [sessionID] } }
}

/** The runner retains every completion read's transport handle for the turn's
 * bounded window. `track` registers one exact request handle before dispatch and
 * its synchronous release unregisters it after transport cleanup; an unresolved
 * handle stays retained for the trial's own postmortem, never swept here. */
export function createCompletionTransportOwner() {
  const live = new Set()
  return { track: handle => { live.add(handle); return () => live.delete(handle) }, outstanding: () => [...live] }
}

/** One runner-owned serial prompt turn with its native completion observation.
 *
 * `makeCompletionReadClient` builds the six reads on the runner's own endpoint
 * lease — the trial's server, its password, this incarnation, this session — and
 * `verifyNativeCompletion` observes the turn through them. `launch` is the caller's
 * existing sole prompt launch: it is dispatched at most once, only after the
 * verifier's baseline and quiescence gate opens, and its raw bytes are hashed exactly
 * as captured, never parsed or rewritten. There is no second prompt path and no
 * event/text-ID guessing here, and no authority: the record stays PROVISIONAL,
 * `accepted:false`, wire `unqualified`, and `execution_qualified`, `complete` and
 * `successor_allowed` remain false absent separate native qualification. The record
 * is persisted privately through `persist` before the turn's own receipt is handed
 * back unchanged. */
export async function runObservedPromptTurn({ binding, origin, authorization, fetchImpl, transportOwner, launch, signal, limits, persist }) {
  if (typeof persist !== "function") throw new Error("a private journal writer is required for the completion observation")
  const leaseAbort = new AbortController()
  let dispatched = null
  const client = makeCompletionReadClient({
    endpointLease: { origin, authorization, incarnationID: binding.incarnationID, sessionIDs: binding.scope.sessionIDs, signal: leaseAbort.signal },
    binding,
    fetchImpl,
    transportOwner,
  })
  try {
    const completion = await verifyNativeCompletion({
      client, binding, signal,
      limits: { deadlineMs: COMPLETION_CEILING_MS, ...limits },
      // The existing sole prompt launch, dispatched once, inside the observation window.
      launch: gate => { dispatched = Promise.resolve().then(() => launch(gate)); return dispatched },
    })
    await persist(completion)
    if (!dispatched) throw new Error("the native completion gate never dispatched the trial's prompt launch")
    return { completion, receipt: await dispatched }
  } catch (error) {
    // A dispatch that outlived the observation must not become an unhandled rejection;
    // the trial's own failure path owns the turn's outcome from here.
    dispatched?.catch(() => {})
    throw error
  } finally {
    leaseAbort.abort()
  }
}

async function runJobBody(job, ctx, track) {
  const id = segment("case id", job.case.id)
  const name = `${id}.t${job.trial}`
  // A retry gets a fresh sandbox root (`<case>.t<n>.a<k>`): the previous attempt's home is never reused, even under
  // --keep. The recordings keep the trial's name, so grading and reporting find them as before.
  const root = within(join(ctx.batchRoot, "runs"), join(ctx.batchRoot, "runs", job.attempt ? `${name}.a${job.attempt}` : name), "the sandbox")
  const sandbox = makeSandbox(root)
  track.phase = "preparing the world"
  const prepared = await ctx.world.prepare({ sandbox, case: job.case, seed: job.case.seed ?? null, trial: job.trial, caller: ctx.caller })
  if (ctx.plugin === "mem" && (!containerContained(ctx.isolation) || prepared.memFixture !== true)) throw new Error("Memory trials require the contained synthetic fixture world")
  const memoryPlan = ctx.plugin === "mem" ? selectMemoryPlan(job.case.id,{trial_id:`${name}-${digestOf(root).slice(0,16)}`,expires_at:Date.now()+ctx.timeoutMs+120000}) : null
  const memoryIntent = memoryPlan?.intent ?? null
  const memFixture = memoryPlan ? stageMemFixture(sandbox, { [memoryPlan.kind]: memoryPlan.spec, intent: memoryIntent }) : null
  const cwd = within(root, prepared.cwd, "the working directory")
  // The case's own files (`Seed: files=`), copied into its project before the world's home is cut of its links.
  track.phase = "seeding the project's files"
  const seeded = seedFiles(job.case.seed, cwd, { env: ctx.caller })
  if (seeded.length) ctx.log(`  ${name}: seeded ${seeded.length} file(s) into the project`)
  const cut = stripForeignLinks(sandbox)
  if (cut.length) ctx.log(`  ${name}: removed ${cut.length} link(s) out of the sandbox that the world's home carried (${cut.slice(0, 3).join(", ")})`)
  // Fake mode: the fake plugins this case uses. The sealed config carries no override: each plugin registers its own server at its default URL, and the trial
  // maps that host name to the fake (a conflicting server of the plugin's own name would switch off its namespace text and tool filter).
  const fakeIds = fakeFor(pluginsOf(job.case), ctx.fakeSet ?? new Set())
  const trialSealed = {...ctx.sealed}
  if (memoryIntent && ctx.sealed.guardDir) {
    const policy=JSON.parse(readFileSync(join(ctx.sealed.guardDir,"guard.json"),"utf8"))
    if(memoryPlan.kind==="discovery"){
      // Only the named synthetic case gains its literal intent. Unrelated families retain no extractor.
      policy.mode=memoryPlan.spec.write?"commit":"refuse"
      if(memoryPlan.spec.write){const family=memoryPlan.spec.binding.tool,action=`mem_${family}`,write=policy.writes.find(w=>w.action===action);if(!write)throw new Error("discovery write is absent from trusted tool metadata");write.memory=family;write.allow=["spc-eval-personal"];const replies={[action]:"once",...(["page","wiki"].includes(family)?{[`${family}.write`]:"once"}:{})};policy.memoryReplies={...replies,...policy.memoryReplies}}
    }
    trialSealed.guardDir=installGuard(sandbox.tmp,{...policy,memoryIntent})
  }
  const config = sealedConfig({ armDir: ctx.armDir, options: memFixture ? memFixtureOptions(memFixture, ctx.options) : ctx.options, model: ctx.model, scripted: Boolean(ctx.scripted), scriptedProvider: ctx.scriptedProvider, ...trialSealed })
  writeConfig(sandbox, config)
  const password = ctx.contained?.password ?? newPassword()
  // This run's secrets: the batch's (the access token, a key passed through) and its own server password.
  // Every token value the batch has read so far and this run's password, built at the moment of each write or scrub, so a
  // rotation since the trial began is covered; a full redactor (with .active and .buffer), so scrubTree can use it.
  const redactorNow = () => redactor([...(ctx.auth.secrets ?? []), password])
  const redact = (text) => redactorNow()(text)
  registerSecrets([password])
  let trial = null
  let gone = false
  try {
    // The trial: under `container`, its own container and network, with the sandbox mounted at its own path.
    track.phase = "starting the trial's container"
    trial = await ctx.isolation.enter({ name, sandbox, mounts: ctx.mounts, cwd, ...(fakeIds.length ? { hosts: hostsFor(fakeIds), ca: ctx.fake.ca } : {}) })
    track.trial = trial
    track.phase = "starting the trial's mock, capture and fake servers"
    let mock = null
    if (ctx.scripted && ctx.mockInTrial) mock = await startTrialMock({ trial, ctx, sandbox })
    const mockUrl = mock?.url ?? ctx.mockUrl
    let capture = null
    if (ctx.captureServer) capture = await startCapture({ trial, ctx, sandbox })
    const fakes = []
    for (const id of fakeIds) fakes.push(await startFakeMcp({ trial, ctx, sandbox, id, port: await freePort() }))
    const memory = memFixture ? await startMemFixture({ spec: memFixture, isolation: ctx.isolation, trial, binary: ctx.nodeBinary, launch: (s) => start(s.command, s.args, { cwd: s.cwd, env: s.env }), stop }) : null
    // A world's own variables go in first and never the sealed ones; the harness's (credential, endpoint) go in last.
    const fromWorld = worldEnv(prepared.env)
    if (fromWorld.dropped.length) ctx.log(`  ${name}: the world's env may not set ${fromWorld.dropped.join(", ")}: ignored`)
    const env = sandboxEnv({ sandbox, config, password, caller: ctx.caller, world: fromWorld.env, extra: { ...(job.authEnv ?? ctx.auth.env), ...(memFixture?.scopeMap ? { EVALS_MEM_SCOPE_MAP: memFixture.scopeMap, EVALS_MEM_TURN_STATE: join(memFixture.root,"turn.json"), EVALS_MEM_ACTIVE_CALL: join(memFixture.root,"active-call.json") } : {}), ...(mockUrl ? { SPIKE_MOCK_URL: mockUrl } : {}), ...(capture ? { ANTHROPIC_BASE_URL: capture.url } : {}) } })
    // Every host command of the run goes through the trial.
    const exec = (args, options = {}) => {
      const spec = trial.wrap({ command: ctx.binary, args, cwd: options.cwd ?? cwd, env: options.env ?? env, stdin: options.input !== undefined && options.input !== null })
      return runToEnd(spec.command, spec.args, { ...options, cwd: spec.cwd, env: spec.env })
    }
    track.phase = "applying the sign-in"
    await ctx.auth.apply({ sandbox, env, exec })
    const before = snapshotFiles(cwd)
    const homeBefore = snapshotHome(sandbox.home, job.case.home_files)
    const started = Date.now()
    let server = null
    let serverStderr = ""
    let result
    const fakeStatus = {}
    let noRequest = null
    let clientRestarts = []
    track.phase = "starting the host's server and running the model"
    try {
      server = await startServer({ binary: ctx.binary, cwd, env, password, trial })
      track.phase = "verifying the vendor sign-in"
      // On this server, not a fresh standalone one: MCP connections start asynchronously, and only a persistent
      // server settles them (a bad token is `needs authentication`, not a tool-less trial).
      await ctx.auth.verify?.({ sandbox, env, exec, url: server.url })
      // A provider can fill its model list after the server answers (the Claude Agent provider probes `claude` first):
      // the run is sent only once its model routes on this server, and a model that never does is the provider's
      // failure, not the model's.
      const routed = await modelRoutes({ trial, binary: ctx.binary, url: server.url, env, cwd, model: ctx.model, timeoutMs: ctx.routeTimeoutMs })
      if (!routed.ok) {
        const why = `the model ${ctx.model} did not route on the trial's server within ${Math.round(ctx.routeTimeoutMs / 1000)} s (it listed ${routed.listed.length ? routed.listed.slice(0, 12).join(", ") : "nothing"})`
        result = { code: null, stdout: "", stderr: why, timedOut: false, error: why, noRoute: true }
      } else {
        // `Seed: continue=<key>` continues a session the world holds, in the sandbox's own copy of it.
        const session = prepared.session ? ["--session", prepared.session] : ["--title", `eval ${id} t${job.trial}`]
        // A scripted trial whose client has not asked the model for anything by `firstRequestMs` is hung, not slow: killed then, and said to be (infra: no_model_request).
        const sawRequest = () => {
          try {
            return /"ev":"request"/.test(readFileSync(join(sandbox.tmp, "mock.jsonl"), "utf8"))
          } catch {
            return false
          }
        }
        const memorySpec = memoryPlan?.spec ?? null
        // The trial's completion identity: the runner's incarnation (the parent's bound
        // invocation inside a contained execution, the runner's own otherwise) and the
        // transport owner that retains this trial's completion read handles.
        const incarnation = ctx.contained?.descriptor?.binding?.invocation_id ?? randomUUID()
        const completionOwner = createCompletionTransportOwner()
        const memoryClient = async ({prompt,session:continued,timeoutMs,index}) => {
          let session=continued
          if (!session) {
            // Existing native /api/session contract (also used by T1): provision identity before granting any intent.
            const created=await exec(["api","--server",server.url,"post","/api/session","-d",JSON.stringify({agent:"build"})],{timeoutMs:10000})
            let value;try{value=JSON.parse(created.stdout)}catch{throw new Error("Memory session provisioning has no typed response")}
            session=value?.data?.id??value?.id
            if(created.code!==0||typeof session!=="string"||!session.startsWith("ses_"))throw new Error("Memory session provisioning failed")
          }
          const file=join(memFixture.root,"turn.json")
          const activation_id=randomUUID()
          const context={case_id:memoryIntent.case_id,trial_id:memoryIntent.trial_id,turn:index,session,activation_id}
          const write=(active)=>{writeFileSync(`${file}.tmp`,JSON.stringify({...context,active}),{mode:0o600});renameSync(`${file}.tmp`,file)}
          // The existing sole prompt launch, unchanged: one `opencode run` against this
          // trial's server, this session, this prompt. The native completion observation
          // wraps it — it never submits a second prompt and never guesses an event or text
          // ID — and its PROVISIONAL record joins the trial's own private recordings.
          const binding=completionTurnBinding({caseID:memoryIntent.case_id,trialID:memoryIntent.trial_id,turn:index,activationID:activation_id,incarnationID:incarnation,sessionID:session})
          const cancel=new AbortController()
          const cancelAt=setTimeout(()=>cancel.abort(),timeoutMs)
          let turn=null
          try{
            const observed=await runObservedPromptTurn({
              binding,
              origin:server.url,
              authorization:`Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
              fetchImpl:fetch,
              transportOwner:completionOwner,
              signal:cancel.signal,
              persist:record=>writeAtomic(within(ctx.rawDir,join(ctx.rawDir,`${name}.native.t${index}.json`),"a recording"),redact(`${JSON.stringify(record)}\n`)),
              launch:gate=>{
                turn=withMemoryActivation({write,client:()=>exec(["run","--server",server.url,"--format","json","-m",ctx.model,"--session",session,prompt],{timeoutMs,...stallOf(ctx,sawRequest)}),observations:()=>nativeMemoryCalls(guardRecords(join(sandbox.tmp,"guard.jsonl")),context),clear:()=>{const receipt=join(memFixture.root,"active-call.json");writeFileSync(`${receipt}.tmp`,"null",{mode:0o600});renameSync(`${receipt}.tmp`,receipt)}})
                return turn.then(result=>({binding:gate.binding,raw:result.outputTruncated?undefined:Buffer.from(result.stdout??""),result}))
              },
            })
            return observed.receipt.result
          }catch(error){
            turn?.catch(()=>{}) // a dispatch that outlived the observation is the trial's failure to report, never an unhandled rejection
            throw error
          }finally{clearTimeout(cancelAt)}
        }
        const runClient = () => memorySpec ? runMemoryTurns({ spec: memorySpec, timeoutMs: ctx.timeoutMs, client: memoryClient }) : exec(["run", "--server", server.url, "--format", "json", "-m", ctx.model, ...session, ctx.prompts.get(job.case.id) ?? job.case.prompt], { timeoutMs: ctx.timeoutMs, ...stallOf(ctx, sawRequest) })
        // An idle client: `opencode run` alive, the server up, the mock never asked (found in 2 of ~100 `p0 a1` runs; the processes were all asleep at 0 % CPU). It is replaced ONCE, and the
        // restart is written into the summary with what the container showed at that moment and reported by the probe: a hang that happens again is infra `no_model_request`, as before.
        const restarts = []
        result = await runClient()
        while (!memoryPlan && result.stalled && ctx.scripted && ctx.mockInTrial && !sawRequest() && restarts.length < (ctx.clientRestarts ?? 1)) {
          restarts.push({ attempt: restarts.length + 1, after_ms: ctx.firstRequestMs, diagnosis: await trial.diagnose?.(), stderr: redact(String(result.stderr ?? "").slice(-1000)) })
          await trial.killClients?.()
          ctx.log(`  ${name}: the client made no model request within ${Math.round(ctx.firstRequestMs / 1000)} s (an idle \`opencode run\` against a live server): restarting it, once`)
          result = await runClient()
        }
        clientRestarts = restarts
        if (ctx.scripted && ctx.mockInTrial && (result.stalled || (result.timedOut && !String(result.stdout ?? "").trim())) && !sawRequest()) {
          noRequest = `the trial made no model request${result.stalled ? ` within ${Math.round(ctx.firstRequestMs / 1000)} s` : ` before its ${Math.round(ctx.timeoutMs / 1000)} s timeout`}: the host's server was up and the client never got as far as its model (an infrastructure hang, not a refusal, not a model's failure)`
          result = { ...result, error: noRequest }
        }
        // Fake mode: what each fake plugin says of itself once the run is over (its own status RPC, as a client of this trial's server), kept beside the recording:
        // the probe compares it with what a signed-in user's plugin says (state connected, source `plugin`: no conflict).
        for (const id of fakeIds) {
          const status = await exec(["api", "--server", server.url, "post", `/api/rpc/${ctx.fake.rpc[id]}/status`, "-d", JSON.stringify({ input: {} })], { timeoutMs: 30_000 })
          fakeStatus[id] = status.stdout
        }
      }
    } catch (error) {
      // A sign-in that cannot be verified is an infrastructure auth failure, not a trial result: rethrow it so the
      // trial's summary names `infra: "auth"` (the finally block still stops the server).
      if (error?.infra === "auth") throw error
      result = { code: null, stdout: "", stderr: String(error.message ?? error), timedOut: false, error: String(error.message ?? error) }
    } finally {
      // What the host printed while it ran (a plugin that failed to load says so here), kept for the summary, scrubbed there.
      serverStderr = server?.proc?.output?.().stderr ?? ""
      await stop(server?.proc)
      await stop(mock?.proc, { graceMs: 200 })
      await stop(capture?.proc, { graceMs: 200 })
      for (const f of fakes) await stop(f.proc, { graceMs: 200 })
      await memory?.stop()
    }
    track.result = result
    track.phase = "recording the trial"
    if (ctx.contained) {
      // Do NOT read the hostile sandbox here. The entire runner is still in the outer container.
      // Raw bytes are already continuously spooled by start(). The parent owns every final read.
      ctx.contained.recordExecution({ exit: result.code ?? null, ...(memFixture ? { capture: `batch/runs/${name}/tmp/mem-fixture/capture.json` } : {}) })
      return { case: id, trial: job.trial, exit: result.code ?? null, provisional: true, usage_missing: true }
    }
    // A command that ended by a signal or an OOM kill, with no exit code of its own: what Docker says of the container is read now, while it exists.
    const oomNow = await trial.oomKills()
    const diagnosis = (result.code === null && !result.timedOut && !result.stalled) || oomNow || noRequest ? await trial.diagnose?.() : null
    // Killing a `docker exec` client leaves what it started running inside: the trial ends here, before anything of
    // its sandbox is read, so nothing it left behind can change the files being recorded.
    const oomKills = oomNow
    await trial.leave({ reason: result.timedOut ? "timeout" : "end" })
    // An interrupted run is not a recording: nothing is written for it, and the batch's own cleanup removes its sandbox.
    if (ctx.interrupted()) throw new Error(`interrupted by ${ctx.interrupted()}`)
    const durationMs = Date.now() - started
    const detail = trial.describe()
    const killed = trial.killed
    // A run that ended with no exit code of its own (a signal, an OOM kill, a client or server that failed to run) and was not stopped by the runner is an infrastructure event with its cause,
    // not a trial the model failed.
    const reported = String(result.error ?? "").trim() || tail(String(result.stderr ?? ""), 300).trim() || "no error was reported"
    const noExitWhy = !preModelFailure(result) && !noRequest && !killed && result.code === null && !result.timedOut && !result.stalled
      ? redact(`the run ended with no exit code${result.signal ? ` (signal ${result.signal})` : ""}: ${reported}${diagnosis ? `; container: ${JSON.stringify(diagnosis.state ?? diagnosis.note ?? {})}` : ""}`)
      : null
    const summary = {
      exit: result.timedOut || result.stalled ? 124 : result.code,
      ...(result.signal ? { signal: result.signal } : {}),
      ...(diagnosis ? { exit_diagnosis: diagnosis } : {}),
      durationMs,
      trial: job.trial,
      case: id,
      arm: ctx.arm.arm,
      model: ctx.model,
      seed: job.case.seed ?? null,
      utc_hour: new Date(started).getUTCHours(),
      ...(prepared.session ? { continued: true } : {}),
      // Scrubbed, then cut: a secret straddling the cut would leave its tail in the summary otherwise.
      server_stderr: redact(String(serverStderr).slice(-6000)),
      stderr: redact(`${result.stderr ?? ""}${result.timedOut ? `\n[evals run] killed after ${ctx.timeoutMs} ms` : ""}${killed ? `\n[evals run] killed: ${killed.reason}` : ""}${noRequest ? `\n[evals run] ${noRequest}` : ""}`).slice(-4000),
      started_at: new Date(started).toISOString(),
      runner: RUNNER,
      runner_version: ctx.runnerVersion,
      opencode: ctx.opencode,
      host: ctx.hostVersion,
      auth: ctx.auth.profile,
      isolation: ctx.isolation.name,
      ...(detail ? { isolation_detail: { ...detail, ...(oomKills ? { oom_kills: oomKills } : {}) } } : {}),
      ...(killed ? { killed: killed.reason } : {}),
      // The model call was refused its credential, or never reached a model (no route): an infrastructure failure,
      // never graded as the model's.
      ...(preModelFailure(result) ? { infra: preModelFailure(result) } : {}),
      ...(noRequest ? { infra: "no_model_request", infra_why: noRequest } : {}),
      ...(noExitWhy ? { infra: "trial_error", infra_why: noExitWhy } : {}),
      ...(clientRestarts.length ? { client_restarts: clientRestarts } : {}),
      ...(usingOverage(result) ? { overage: true } : {}),
      ...(fromWorld.dropped.length ? { world_env_ignored: fromWorld.dropped } : {}),
      ...(ctx.isolation.unsafe ? { unsafe_no_isolation: true } : {}),
      world: ctx.worldInfo,
      batch: ctx.batch,
      dollar_cap: ctx.dollarCap,
      provenance: ctx.arm.provenance,
      ...(result.error ? { error: result.error } : {}),
    }
    // The sandbox is hostile once a run has been in it: a working directory it replaced with a link out of the sandbox
    // is not walked, so no file outside the sandbox can reach the files record.
    const files = [...(inside(root, cwd) ? changedFiles(before, cwd) : []), ...(job.case.home_files?.length ? changedHome(homeBefore, sandbox.home, job.case.home_files) : []), ...(memFixture ? [await memCaptureRecord(memFixture, trial, result.turns)] : [])]
    const linked = job.case.home_files?.length ? homeLinks(sandbox.home, job.case.home_files) : []
    if (linked.length) summary.home_links_refused = linked
    if (!inside(root, cwd)) summary.files_refused = "the working directory no longer resolves inside the sandbox"
    // Every file written for the run is scrubbed of its secrets first: the recording, the summary, the files record.
    const out = (suffix) => within(ctx.rawDir, join(ctx.rawDir, `${name}${suffix}`), "a recording")
    writeAtomic(out(".jsonl"), redact(result.stdout ?? ""))
    // The guard's own log (what it asked, rejected and refused): next to the recording, scrubbed like it, and counted in the summary.
    // The scripted model's own log (a probe's `[[mock:dump]]` reads what reached the model from it), beside the recording, scrubbed like it.
    if (ctx.scripted && existsSync(join(sandbox.tmp, "mock.jsonl"))) writeAtomic(out(".mock.jsonl"), redact(readFileSync(join(sandbox.tmp, "mock.jsonl"), "utf8")))
    // The fake MCP servers' logs (what the model asked of them), beside the recording, scrubbed like it.
    for (const [id, status] of Object.entries(fakeStatus)) writeAtomic(out(`.fake-${id}.status.json`), redact(status))
    for (const id of fakeIds) if (existsSync(join(sandbox.tmp, `fake-${id}.jsonl`))) writeAtomic(out(`.fake-${id}.jsonl`), redact(readFileSync(join(sandbox.tmp, `fake-${id}.jsonl`), "utf8")))
    // The capture server's log (P0-13), beside the recording, scrubbed like it.
    if (ctx.captureServer && existsSync(join(sandbox.tmp, "capture.jsonl"))) writeAtomic(out(".capture.jsonl"), redact(readFileSync(join(sandbox.tmp, "capture.jsonl"), "utf8")))
    const guardLog = guardRecords(join(sandbox.tmp, "guard.jsonl"))
    if (guardLog.length) writeAtomic(out(".guard.jsonl"), redact(`${guardLog.map((r) => JSON.stringify(r)).join("\n")}\n`))
    summary.guard = guardSummary(guardLog)
    // A write that completed where none may (G0 review 1.1): the runner reads it from the outcome and halts the wave.
    const halt = haltReason(guardLog)
    if (halt) summary.halt = halt
    summary.host_log = hostLogFacts(sandbox.home)
    // A plugin that failed to load registers nothing, silently, and its cases would be graded as the model's failure (boxd and gws did
    // exactly that before their files were copied): infra, never graded, and the batch stops (G0 review 1.6).
    if (!summary.infra && summary.host_log.plugin_load_failures?.length) summary.infra = "plugin"
    writeAtomic(out(".summary.json"), redact(`${JSON.stringify(summary, null, 1)}\n`))
    writeAtomic(out(".files.json"), redact(`${JSON.stringify(files, null, 1)}\n`))
    // Only once the trial is confirmed gone is its sandbox touched: removed, or kept and scrubbed.
    gone = await trial.gone()
    if (!gone) ctx.log(`  ${name}: the trial's container is still there: its sandbox is kept, not removed`)
    if (!ctx.keep && gone) removeSandbox(within(ctx.batchRoot, root, "the sandbox"))
    const cost = billedOf(result.stdout ?? "")
    // What this run's own tool calls spent at vendors that bill for reads (R14), counted from the recording.
    try {
      const calls = summarize((result.stdout ?? "").split("\n").filter(Boolean), result.stderr ?? "").calls
      cost.vendor_use = vendorUseOf(calls.flatMap((call) => [call.tool, ...(call.inner ?? [])]))
    } catch {
      // a recording that does not parse spent nothing we can count
    }
    // Rate-limited with retries left: nothing is recorded, nothing is released (the reservation stays for the retry), and the
    // caller backs off. A retry needs the previous container confirmed gone; otherwise the trial fails as infra and is
    // released. After the last retry it is an infrastructure failure like a refused credential, and is released.
    if (!summary.infra && rateLimited(result)) {
      const next = rateLimitOutcome(job.attempt ?? 0, gone, ctx.retryLimit)
      if (next.retry) return { case: id, trial: job.trial, rateLimited: true, exit: summary.exit, durationMs, ...(halt ? { halt } : {}) }
      summary.infra = next.infra
      if (next.why) summary.infra_why = next.why
      writeAtomic(out(".summary.json"), redact(`${JSON.stringify({ ...summary, attempts: (job.attempt ?? 0) + 1 }, null, 1)}\n`))
    }
    if (ctx.retryLimit === 0) {
      const observed = settleSingleAttempt(ctx.store, { batch: ctx.batch, month: ctx.month, iteration: ctx.iteration, plugin: ctx.plugin, model: ctx.model, case: id, trial: job.trial, exit: summary.exit, duration_ms: durationMs, tier: tierOf(job.case), ...(summary.infra ? { infra: summary.infra } : {}) }, result, ctx.listPrice)
      return { case: id, trial: job.trial, exit: summary.exit, durationMs, ...(summary.infra ? { infra: summary.infra } : {}), ...(halt ? { halt } : {}), ...(summary.overage ? { overage: true } : {}), ...((observed.usage_missing || observed.billed_incomplete) ? { usage_missing: true, error: "single attempt ended with unresolved usage or cost" } : {}) }
    }
    // Priced at list as well as billed: a subscription run bills $0, and the round's ceiling counts list price (R9).
    cost.list_usd = listUsdOf(cost.tokens, ctx.listPrice)
    cost.tier = tierOf(job.case)
    // A run that did model work and reported no tokens (or whose model has no list price) would add $0 to what the round has spent:
    // it is counted at the estimate, marked, and returned as an error so the batch's record names it (G0 review 1.3).
    const reportedNothing = isMetered(ctx.model) && !summary.infra && (cost.list_usd === null || Object.values(cost.tokens ?? {}).every((n) => !n))
    if (reportedNothing) {
      const estimate = ctx.estimateUsd?.(cost.tier) ?? null
      cost.list_usd = estimate
      cost.usage_missing = true
    }
    if (summary.infra) {
      // Never graded. A failure before the model did any work spent nothing: its reservation goes back, so it can be
      // rerun from the reserve. A run cut short after the model worked (its sign-in revoked mid-run) did spend: it is
      // recorded with what it billed, marked infra, and counts against the run and dollar caps like any other run.
      const worked = cost.billed_usd > 0 || Object.values(cost.tokens ?? {}).some((n) => n > 0)
      if (worked) recordRun(ctx.store, { batch: ctx.batch, month: ctx.month, iteration: ctx.iteration, plugin: ctx.plugin, model: ctx.model, case: id, trial: job.trial, exit: summary.exit, duration_ms: durationMs, infra: summary.infra, ...cost })
      else release(ctx.store, ctx.batch, 1)
      return { case: id, trial: job.trial, exit: summary.exit, durationMs, infra: summary.infra, ...(halt ? { halt } : {}), ...(worked ? { spent: true } : {}), ...(result.error ? { error: redact(result.error) } : {}) }
    }
    recordRun(ctx.store, { batch: ctx.batch, month: ctx.month, iteration: ctx.iteration, plugin: ctx.plugin, model: ctx.model, case: id, trial: job.trial, exit: summary.exit, duration_ms: durationMs, ...cost })
    return { case: id, trial: job.trial, exit: summary.exit, durationMs, ...(halt ? { halt } : {}), ...(summary.overage ? { overage: true } : {}), ...(cost.usage_missing ? { usage_missing: true, error: `the run reported no tokens: counted at the estimate ($${cost.list_usd ?? "unknown"})` } : {}), ...(killed ? { killed: killed.reason } : {}), ...(result.error ? { error: redact(result.error) } : {}) }
  } catch (error) {
    // What Docker says of the container is read before the finally block removes it, and goes with the error to the failure summary.
    track.diagnosis = trial ? await trial.diagnose?.().catch(() => null) : null
    throw error
  } finally {
    // The trial ends on every path (idempotent); a credentials file goes on every path, a run that failed, threw or was
    // interrupted included; a kept sandbox keeps no secret.
    await trial?.leave({ reason: "finally" })
    if (trial && !gone) gone = await trial.gone()
    if (!ctx.contained) {
      ctx.auth.cleanup({ sandbox, gone: trial ? gone : true })
      if (ctx.keep && (gone || !trial)) scrubTree(root, redactorNow())
    }
  }
}

/** The infra class of a trial that threw: a marked `auth.apply` failure is auth (never the model's), an interrupt is
 * interrupted, anything else a trial error. */
export const failureInfra = (error, interrupted = /^interrupted by /.test(String(error?.message ?? error))) => (interrupted ? "interrupted" : error?.infra === "auth" ? "auth" : "trial_error")

/**
 * One trial, with the promise that it ends in a summary on disk, never in silence. The summary is first a stub (`infra: trial_incomplete`: the runner began this trial and never finished it,
 * as when it was killed), then the trial's own; a trial whose job throws gets a failure summary in place of the stub with the phase it reached, the error and its stack, what Docker
 * said of the container (state, exit code, OOM, the last log lines) and the host's own stderr, and is reported as `infra: trial_error`: never graded, never lost, and its reservation
 * goes back unless the model had already worked (found in 1 of 50 `p0 a1` runs: a trial with no summary, whose cause was lost).
 */
async function runJob(job, ctx) {
  if (ctx.contained) {
    const track = { phase: "starting", trial: null, result: null, diagnosis: null }
    try { return await runJobBody(job, ctx, track) }
    catch {
      ctx.contained.recordExecution({ exit: track.result?.code ?? null })
      return { case: job.case.id, trial: job.trial, exit: null, provisional: true, usage_missing: true }
    }
  }
  const id = segment("case id", job.case.id)
  const name = `${id}.t${job.trial}`
  const file = within(ctx.rawDir, join(ctx.rawDir, `${name}.summary.json`), "a recording")
  const base = { trial: job.trial, case: id, arm: ctx.arm?.arm, model: ctx.model, batch: ctx.batch, started_at: new Date().toISOString(), runner: RUNNER, runner_version: ctx.runnerVersion }
  const track = { phase: "starting", trial: null, result: null, diagnosis: null }
  const redact = redactor(ctx.auth.secrets ?? [])
  const write = (summary) => writeAtomic(file, redact(`${JSON.stringify(summary, null, 1)}\n`))
  try {
    write({ exit: null, incomplete: true, infra: "trial_incomplete", infra_why: "the runner began this trial and never wrote its summary: it was stopped, or crashed, before the trial ended", ...base })
  } catch {
    // a store that cannot be written to fails the trial below, with the same cause
  }
  try {
    return await runJobBody(job, ctx, track)
  } catch (error) {
    const message = redact(String(error?.message ?? error))
    const interrupted = /^interrupted by /.test(message)
    const infra = failureInfra(error, interrupted)
    const modelRan = Boolean(track.result?.stdout)
    const summary = {
      exit: track.result ? (track.result.timedOut || track.result.stalled ? 124 : track.result.code ?? null) : null,
      ...(track.result?.signal ? { signal: track.result.signal } : {}),
      ...base,
      infra,
      infra_why: `${interrupted ? "the batch was interrupted" : error?.infra === "auth" ? "the trial's sign-in was not usable" : "the trial's job failed"} while ${track.phase}: ${message}`,
      phase: track.phase,
      error: message,
      stack: redact(String(error?.stack ?? "").split("\n").slice(0, 10).join("\n")),
      ...(track.diagnosis ? { exit_diagnosis: track.diagnosis } : {}),
      ...(track.result ? { stderr: redact(String(track.result.stderr ?? "").slice(-4000)), model_ran: modelRan } : {}),
    }
    try {
      write(summary)
      if (track.result?.stdout) writeAtomic(within(ctx.rawDir, join(ctx.rawDir, `${name}.jsonl`), "a recording"), redact(track.result.stdout))
    } catch (writing) {
      ctx.log(`  ${name}: could not write the failure summary: ${redact(String(writing?.message ?? writing))}`)
    }
    ctx.log(`  ${name}: FAILED while ${track.phase}: ${message}${track.diagnosis?.state ? ` (container ${JSON.stringify(track.diagnosis.state)})` : ""}`)
    if (!interrupted) {
      // A failure before the model did any work spent nothing: its reservation goes back. One after it did is recorded at what it billed.
      if (ctx.retryLimit === 0) {
        settleSingleAttempt(ctx.store, { batch: ctx.batch, month: ctx.month, iteration: ctx.iteration, plugin: ctx.plugin, model: ctx.model, case: id, trial: job.trial, exit: summary.exit, duration_ms: null, infra: summary.infra, tier: tierOf(job.case) }, track.result ?? {}, ctx.listPrice)
      } else if (modelRan) {
        try {
          recordRun(ctx.store, { batch: ctx.batch, month: ctx.month, iteration: ctx.iteration, plugin: ctx.plugin, model: ctx.model, case: id, trial: job.trial, exit: summary.exit, duration_ms: null, infra: summary.infra, ...billedOf(track.result.stdout) })
        } catch {
          // the record is the ledger's: an unreadable recording spent nothing we can count
        }
      } else release(ctx.store, ctx.batch, 1)
    }
    return { case: id, trial: job.trial, exit: summary.exit, infra: summary.infra, error: message, why: summary.infra_why }
  }
}

/**
 * The whole batch. `options` mirrors the CLI flags; `caller` is the environment the runner was started with.
 */
/**
 * The binaries a trial needs, mounted read-only into a container: the host, a provider's own CLI, the mock's bun, and
 * Node when browse is in the trial (its MCP server is a `bin/mcp.mjs` script the host runs by its `#!/usr/bin/env node`
 * shebang; the image has no Node). `EVALS_NODE_BIN` names the host Node to mount, as `EVALS_CLAUDE_BIN` does for
 * `claude`.
 */
export const trialBinaries = ({ binary, needsClaude = false, needsBrowse = false, needsMemory = false, scripted = false, captureServer = false, fakeIds = [], caller = process.env }) => ({
  opencode: binary,
  ...(needsClaude ? { claude: caller.EVALS_CLAUDE_BIN ?? "claude" } : {}),
  ...(needsBrowse ? { node: caller.EVALS_NODE_BIN ?? "node" } : {}),
  ...(scripted || captureServer || fakeIds.length ? { bun: caller.EVALS_BUN ?? "bun" } : {}),
  ...(needsMemory ? { node: caller.EVALS_NODE ?? "node" } : {}),
})

/**
 * Is browse in this trial: the plugin under test, or any selected case whose `Seed: plugins=` names it (a companion).
 * `pluginsOf` is the one reader of a case's plugin and seed, so a seed that names browse counts exactly as its own case does.
 */
export const browseInTrial = (plugin, cases = []) => plugin === "browse" || cases.some((c) => pluginsOf(c).includes("browse"))

export async function runBatch(options, { caller = process.env, log = (line) => console.log(line) } = {}) {
  // Before store/auth/world access: an ordinary CLI or an environment hint grants no capability.
  const contained = (options.isolation ?? caller.EVALS_ISOLATION) === "owned-container" ? ownedSession(options.ownedSession) : null
  if (contained && (JSON.stringify(Object.fromEntries(Object.entries(options).filter(([k]) => k !== "ownedSession"))) !== JSON.stringify(contained.options) || caller.HOME !== "/work/home" || caller.EVALS_TMP !== "/work/tmp" || caller.EVALS_STORE !== "/work/store")) throw new Error("owned descriptor/options or work paths disagree")
  const retryLimit = harnessRetryLimit(options.harnessRetries)
  setProcessGroupMode(options.processGroup ?? "isolated")
  if (options.condition !== undefined && !["direct", "search"].includes(options.condition)) throw new Error("--condition must be direct or search")
  if (options.condition && (typeof options.conditionQualification !== "string" || !options.conditionQualification)) throw new Error("--condition requires --condition-qualification with observed pinned runtime evidence")
  if (options.conditionQualification && !options.condition) throw new Error("--condition-qualification requires --condition")
  const plugin = options.plugin
  const iteration = options.iteration
  if (!plugin) throw new Error("--plugin <id> is required")
  if (!iteration) throw new Error("--iteration <name> is required")
  segment("--plugin", plugin)
  segment("--iteration", iteration)
  if (!options.model) throw new Error("--model <provider>/<model> is required, e.g. claude-agent/haiku")
  const trials = Number(options.trials ?? 1)
  const parallel = Number(options.parallel ?? 4)
  if (!Number.isInteger(trials) || trials < 1) throw new Error("--trials must be a whole number of at least 1")
  if (!Number.isInteger(parallel) || parallel < 1) throw new Error("--parallel must be a whole number of at least 1")
  const store = options.store ?? storeRoot(caller)
  const halted = readHalt(store)
  if (halted) throw new Error(haltMessage(halted))
  // The repository's cases and the store's private holdouts, or exactly the directory --cases-dir names.
  const caseList = pluginCases(plugin, { dir: options.casesDir ?? null, env: caller })
  if (!caseList.length) throw new Error(`no compiled cases for ${plugin}${options.casesDir ? ` in ${options.casesDir}` : ""}`)
  const { selected: chosen } = selectCases(caseList, { patterns: options.cases ?? "*", set: options.set ?? "tune" })
  // What may run on this model, with its placeholders filled from the private store (R5): a case that reads a third party's words
  // never goes to an `opencode/*` model, and one the store cannot fill is deferred, each with its reason in the batch record.
  // The plugins that run with no account (GitHub and Jira): their cases hold no credential, need no target, and read no one's words.
  const noAccount = noAccountPlugins({ packs: loadPacks(), store })
  // Fake mode (GitHub, Jira): no account and no real endpoint, served by the harness's fake MCP server, so measurable. No credential for either kind.
  const fakeSet = fakePlugins({ packs: loadPacks(), store })
  const noCredential = noCredentialPlugins({ packs: loadPacks(), store })
  const gated = gateCases(chosen, { model: options.model, targets: loadTargets(caller), canaries: loadCanaries(caller), matrix: loadDataMatrix(caller), noAccount })
  let selected = gated.runnable
  const deferred = [...gated.deferred]
  // `--preflight data` (R10): a case whose clauses name a target, a canary or a seed the store lacks would only be BLOCKED later, so it
  // is deferred now, each with the missing name. Re-run before every variant batch and before h1, so a drifted store is seen at once.
  if (options.preflight) {
    if (options.preflight !== "data") throw new Error(`--preflight must be data, not ${JSON.stringify(options.preflight)}`)
    const found = dataPreflight(selected, { targets: loadTargets(caller), canaries: loadCanaries(caller), env: caller, noAccount })
    deferred.push(...found)
    const skip = new Set(found.map((d) => d.case))
    selected = selected.filter((c) => !skip.has(c.id))
  }
  if (!selected.length) throw new Error(`nothing to run: all ${chosen.length} selected case(s) are deferred (${deferred.slice(0, 3).map((d) => `${d.case}: ${d.why}`).join("; ")}${deferred.length > 3 ? "; …" : ""})`)
  const rawDir = within(rawRoot(caller), join(rawRoot(caller), iteration, plugin), "the recordings directory")
  const jobs = plan({ cases: selected, trials, recorded: recordedTrials(rawDir), append: Boolean(options.append) })
  if (contained && (jobs.length !== 1 || jobs[0].trial !== 1 || jobs[0].case.id !== contained.options.cases)) throw new Error("owned execution must select exactly its bound physical trial")

  // An arm is a built plugin directory, `none`, or a JSON file naming one and the options it runs with:
  //   { "package": "../opencode-history", "options": { "access": "ask-changes" } }
  let armSpec = options.arm
  let pluginOptions = options.options ? JSON.parse(options.options) : null
  let companionSpec = null
  let companionBase = null
  let guardWanted = null
  if (armSpec && armSpec !== "none" && armSpec.endsWith(".json")) {
    const manifest = JSON.parse(readFileSync(armSpec, "utf8"))
    if (pluginOptions && manifest.options) throw new Error(`${armSpec} sets options; --options would override them: pass one`)
    pluginOptions = pluginOptions ?? manifest.options ?? null
    companionSpec = manifest.companions ?? null
    companionBase = dirname(resolve(armSpec))
    if (manifest.guard !== undefined) guardWanted = Boolean(manifest.guard)
    armSpec = manifest.package === "none" ? "none" : resolve(dirname(resolve(armSpec)), manifest.package)
  }
  const armSource = armSpec === "none" ? null : armSpec ?? pluginRepo(plugin, caller)
  if (armSpec !== "none" && !armSource) throw new Error(`no build for ${plugin}: pass --arm <built plugin dir> (or none), or set EVALS_REPO_${plugin.toUpperCase()} or EVALS_PLUGIN_ROOT`)
  const binary = hostBinary({ host: options.host, env: caller })
  const conditionProof = options.condition ? qualifyConditions(JSON.parse(readFileSync(options.conditionQualification, "utf8")), {
    runtime_sha256: sha256(readFileSync(binary)), archive_sha256: memoryArtifact(armSource).archive_sha256, model: options.model,
  }) : null
  const caps = loadCaps(store, caller)
  const month = monthOf()

  // Live or not is decided by what the run would be given: a credential, and the config the harness seals. Only the
  // harness's own scripted model with no credential is not live. Decided, and refused, before a world module is
  // imported: importing one runs its code.
  const parsedAuth = parseAuth(options.auth ?? caller.EVALS_AUTH)
  // `+profile` gives a trial the evals profile's vendor credentials; a batch whose every plugin runs with no account has none to give.
  const profile = parsedAuth.vendor && selected.length && selected.every((c) => pluginsOf(c).every((id) => noCredential.has(id))) ? { ...parsedAuth, vendor: false } : parsedAuth
  // A key passed through is a secret from the start: a world build's error output is scrubbed of it too.
  if (profile.kind === "env") registerSecrets(profile.names.map((name) => caller[name]))
  const scripted = Boolean(options.scripted)
  // The guard is what stops a write that resolves to `allow`, turns away an ask nobody answers, and records one that completes. It is
  // switched off only to probe the host alone, so a trial that holds any credential never runs without it (G0 review 1.6).
  const holdsCredential = profile.kind !== "none" || Boolean(profile.vendor)
  if (holdsCredential && (guardWanted === false || (options.guardMode && !["refuse", "commit"].includes(options.guardMode)))) throw new Error(`the guard cannot be switched off (\"guard\": false, or a guard mode of ${JSON.stringify(options.guardMode ?? "off")}) in a run that holds a credential (--auth ${options.auth ?? caller.EVALS_AUTH}): that setting is for probes with no credential`)
  // What the model may do: `locked` (the default) removes the shell, file, web and subagent tools and makes every write an
  // ask; `local` keeps them, for the credential-free arm only (G1): it is refused with any vendor credential.
  const toolsMode = options.tools ?? "locked"
  if (!["locked", "local"].includes(toolsMode)) throw new Error(`--tools must be locked or local, not ${JSON.stringify(toolsMode)}`)
  if (toolsMode === "local" && profile.vendor) throw new Error("--tools local keeps the shell and the file tools, and is refused with a vendor credential (+profile): run the local set with no profile")
  // The set and the arm must agree: a `local` case measures shell-first behaviour and needs the credential-free arm; every other
  // case runs locked. A commit case really writes, and only with a commit plan (the guard's in-scope list and the asks it opens).
  const localCases = selected.filter((c) => (c.sets ?? []).includes("local"))
  if (toolsMode === "local" && localCases.length !== selected.length) throw new Error(`--tools local runs only cases in set local (${selected.length - localCases.length} selected case(s) are not: ${selected.filter((c) => !(c.sets ?? []).includes("local")).slice(0, 3).map((c) => c.id).join(", ")})`)
  if (toolsMode === "locked" && localCases.length) throw new Error(`${localCases.length} selected case(s) are in set local (${localCases.slice(0, 3).map((c) => c.id).join(", ")}): run them with --tools local and no +profile`)
  const commitCases = selected.filter((c) => (c.sets ?? []).includes("commit"))
  if (commitCases.length && !options.commitPlan) throw new Error(`${commitCases.length} selected case(s) are in set commit (${commitCases.slice(0, 3).map((c) => c.id).join(", ")}): they really write, and run only with --commit-plan <file> naming what they may write`)
  if (options.commitPlan && commitCases.length !== selected.length) throw new Error("--commit-plan runs only cases in set commit: every other case stays at the ask")
  // The plan names @aliases of targets.json only; they are resolved here, and a literal or an unknown alias is refused.
  const commitPlan = options.commitPlan ? resolveCommitPlan(JSON.parse(readFileSync(options.commitPlan, "utf8")), loadTargets(caller)) : null
  if (scripted && options.model !== SCRIPTED_MODEL) throw new Error(`--scripted runs the harness's scripted model, ${SCRIPTED_MODEL}: --model ${options.model} is not it`)
  const live = isLive({ auth: profile.kind, model: options.model, config: sealedConfig({ armDir: null, model: options.model, scripted }) })
  // Every run is confined in a container unless the caller names another backend: the scripted model can call tools too.
  const isolationName = options.isolation ?? (caller.EVALS_ISOLATION || null) ?? defaultIsolation()
  const baseConfig = isolationName === "container" ? containerConfig({ store, env: caller }) : null
  // Each batch reaches the model's hosts, and the hosts of the credentialed plugins its cases name, and nothing else (R3).
  const egress = baseConfig ? batchEgress({ model: options.model, vendor: Boolean(profile.vendor), exclude: noCredential, cases: selected, packs: loadPacks(), targets: loadTargets(caller), base: baseConfig.allow, explicit: Boolean(baseConfig.source || caller.EVALS_EGRESS_ALLOW) }) : null
  const isolationSpec = { name: isolationName, live, unsafe: Boolean(options.unsafeNoIsolation), config: contained ? { ownedSession: options.ownedSession } : baseConfig ? { ...baseConfig, allow: egress.allow } : null }
  if (options.dryRun) {
    log(`evals run: ${plugin} ${iteration}  ${selected.length} case(s) x ${trials} trial(s) = ${jobs.length} run(s)  model ${options.model}  parallel ${parallel}`)
    let refused = false
    try {
      const isolation = selectIsolation(isolationSpec)
      log(`isolation: ${isolation.name}${isolation.unsafe ? " (UNSAFE: the filesystem is not confined)" : ""}${live ? "" : " (not live: the scripted model, no credential; still confined, since it can call tools)"}`)
      if (isolation.config) log(`  egress allowed to ${isolation.config.allow.join(", ")} on 443; limits ${JSON.stringify(isolation.config.limits)}`)
      if (isolation.maxParallel && parallel > isolation.maxParallel) log(`dry run: the batch would be refused: --parallel ${parallel} is more than the container backend's ${isolation.maxParallel}`)
    } catch (error) {
      refused = true
      log(`dry run: the batch would be refused: ${error.message}`)
    }
    if (!refused) {
      const world = await loadWorld(options.world ?? caller[`EVALS_WORLD_${plugin.toUpperCase()}`] ?? null)
      log(`world: ${world.name}`)
      // What the cases were written from, against the world as it is now (a rebuild may still change it).
      try {
        const truth = truthCheck(selected, world)
        if (truth) log(truth.bad.length ? `dry run: the batch would be refused unless a rebuild fixes it: ${truth.bad.map(renderTruthProblem).join("; ")}` : `truth: ${truth.rows.length} claim(s) of ${new Set(truth.rows.map((r) => r.case)).size} case(s) hold in the world as built`)
      } catch (error) {
        log(`dry run: the batch would be refused: ${error.message}`)
      }
    }
    // The sign-in's expiry, read as a real batch would read it (its content never shown).
    if (profile.kind === "claude-agent" && caller.HOME) {
      try {
        const signIn = readCredential(join(caller.HOME, ".claude", ".credentials.json"))
        if (signIn.expiresAt !== null) log(`credential: the sign-in expires at ${new Date(signIn.expiresAt).toISOString()}`)
        else {
          const expiry = unknownExpiry(Boolean(options.acceptUnknownTokenExpiry))
          log(`credential: expires ${expiry.expires}, accepted_by_flag ${expiry.accepted_by_flag} (--accept-unknown-token-expiry)`)
        }
      } catch (error) {
        log(`dry run: the batch would be refused: ${error.message}`)
      }
    }
    const used = checkCaps(readLedger(store), caps, { month, plugin, iteration, runs: 0 })
    for (const job of jobs) log(`  ${job.case.id}.t${job.trial}`)
    log(`runs reserved: ${plugin} ${used.per_plugin_month}/${caps.per_plugin_month} this month, all plugins ${used.total_month}/${caps.total_month}; this batch would add ${jobs.length}`)
    try {
      checkCaps(readLedger(store), caps, { month, plugin, iteration, runs: jobs.length })
      log("dry run: nothing launched, nothing reserved")
    } catch (error) {
      log(`dry run: the batch would be refused: ${error.message}`)
    }
    return { planned: jobs.length, launched: 0, dryRun: true }
  }

  // No run without a backend that confines the filesystem, unless the caller says so in so many words.
  const isolation = selectIsolation(isolationSpec)
  if (isolation.unsafe) log("WARNING: --unsafe-no-isolation: the agent under test can read and write anything this user can, by absolute path")
  // Each trial has its own network, from Docker's limited address pools.
  if (isolation.maxParallel && parallel > isolation.maxParallel) throw new Error(`--parallel ${parallel} is more than the container backend allows (${isolation.maxParallel}, max_parallel in caps.json's container section)`)
  const world = await loadWorld(options.world ?? caller[`EVALS_WORLD_${plugin.toUpperCase()}`] ?? null)
  log(`evals run: ${plugin} ${iteration}  ${selected.length} case(s) x ${trials} trial(s) = ${jobs.length} run(s)  model ${options.model}  parallel ${parallel}  world ${world.name}`)
  // A kept sandbox keeps the credential imported into it: only when asked for in so many words.
  if (options.keep && profile.kind === "claude-agent" && !options.keepCredentials) throw new Error("--keep with --auth claude-agent keeps the imported credential in the sandboxes: add --keep-credentials to mean it")

  // On disk, not in a memory-backed /tmp: a trial that fills its sandbox would otherwise fill the machine's memory.
  const tmpRoot = batchTmp(caller)
  const batchRoot = contained ? "/work/batch" : within(tmpRoot, mkdtempSync(join(tmpRoot, `evals-run-${iteration}-`)), "the batch directory")
  if (contained) mkdirSync(batchRoot, { mode: 0o700 })
  // The marker that lets a later sweep remove this directory if this runner dies without cleaning up (container only).
  if (isolation.batchLabel) markBatchDir(batchRoot, isolation.batchLabel)

  // From here on, an interrupt (Ctrl-C, SIGTERM) or an uncaught error stops every process group this batch started,
  // removes the sandboxes (and the credential imported into them) unless --keep, releases the runs that never
  // launched, writes the batch record, and exits non-zero. `finish` is the one cleanup, shared with a normal end.
  let reservation = null
  let launched = 0
  let stopped = null
  let interrupted = null
  const results = []
  let finished = false
  const startedJobs = []
  let keepRoot = Boolean(options.keep)
  const facts = {}
  let mock = null
  let redact = redactor([])
  const finish = (facts = {}, { gone = true } = {}) => {
    if (finished) return
    finished = true
    if (contained) return // No final summaries, cleanup, release or accounting inside the workload.
    if (retryLimit === 0 && reservation) {
      const recorded = readLedger(store).filter(e => e.kind === "run" && e.batch === reservation.batch)
      for (const job of startedJobs) {
        if (recorded.some(e => e.case === job.case.id && e.trial === job.trial)) continue
        const file = join(rawDir, `${job.case.id}.t${job.trial}.jsonl`)
        const stdout = existsSync(file) ? readFileSync(file, "utf8") : ""
        settleSingleAttempt(store, { batch: reservation.batch, month: reservation.month, iteration, plugin, model: options.model, case: job.case.id, trial: job.trial, exit: null, infra: "trial_incomplete", tier: tierOf(job.case) }, { stdout })
      }
    }
    if (reservation) release(store, reservation.batch, jobs.length - launched)
    // No sign-in file outlives the batch, and a kept batch directory holds no secret, whatever path ended the batch;
    // but nothing in it is touched while a container of the batch may still be running.
    if (!gone) {
      keepRoot = true
      facts.containers_left = true
      log(`evals run: a container of this batch is still there: ${batchRoot} is kept untouched; \`evals isolation sweep\`, then delete it`)
    }
    scrubCredentials(batchRoot, gone)
    if (keepRoot && gone) scrubTree(batchRoot, redact)
    if (!keepRoot) removeSandbox(within(tmpRoot, batchRoot, "the batch directory"))
    if (reservation) {
      const record = { batch: reservation.batch, iteration, plugin, model: options.model, runner: RUNNER, runner_version: harnessVersion(), ...facts, trials, cases: selected.map((c) => c.id), planned: jobs.length, launched, stopped, ran_at: new Date().toISOString(), results }
      mkdirSync(rawDir, { recursive: true, mode: 0o700 })
      writeAtomic(within(rawDir, join(rawDir, `batch-${segment("batch id", reservation.batch)}.json`), "the batch record"), redact(`${JSON.stringify(record, null, 1)}\n`))
    }
  }
  const onInterrupt = async (reason, code) => {
    if (interrupted) return
    interrupted = reason
    stopped = `interrupted by ${reason}`
    try {
      log(`evals run: ${stopped}; stopping every run this batch started`)
    } catch {
      // a closed output must not keep the batch from stopping
    }
    await killAll()
    // Killing a `docker exec` client does not stop what it started inside: every trial container, its network and the
    // proxy are removed before the batch is written up.
    await isolation.teardown().catch((error) => log(`evals run: isolation teardown: ${error.message ?? error}`))
    if (isolation.egress?.()) facts.egress = isolation.egress()
    const gone = await isolation.allGone().catch(() => false)
    try {
      finish(facts, { gone })
    } finally {
      process.exit(code)
    }
  }
  const handlers = {
    SIGINT: () => onInterrupt("SIGINT", 130),
    SIGTERM: () => onInterrupt("SIGTERM", 143),
    // A handler that logs must never throw into itself: a log line to a closed pipe is an error, which would call this handler again, for ever.
    uncaughtException: (error) => {
      try {
        log(`evals run: ${error?.stack ?? error}`)
      } catch {
        // nobody is reading the output: the batch is stopped all the same
      }
      onInterrupt("an uncaught error", 1)
    },
    unhandledRejection: (error) => {
      try {
        log(`evals run: ${error?.stack ?? error}`)
      } catch {
        // as above
      }
      onInterrupt("an unhandled rejection", 1)
    },
  }
  for (const [event, handler] of Object.entries(handlers)) process.on(event, handler)
  const unhook = () => {
    for (const [event, handler] of Object.entries(handlers)) process.off(event, handler)
  }
  try {
    // The host's version, asked in a sandbox of its own: even `--version` reads nothing of the caller's install.
    const probe = makeSandbox(join(batchRoot, "probe"))
    const probeEnv = sandboxEnv({ sandbox: probe, config: sealedConfig({ armDir: null, model: options.model }), password: newPassword(), caller })
    // The binaries a trial needs, mounted read-only into a container: the host, a provider's own CLI, the mock's bun,
    // and Node when browse is in the trial (its MCP wrapper is a Node script).
    const needsClaude = profile.kind === "claude-agent" || options.model.startsWith("claude-agent/")
    const needsBrowse = browseInTrial(plugin, selected)
    // The fake-mode plugins any selected case uses.
    const fakeIds = [...new Set(selected.flatMap((c) => fakeFor(pluginsOf(c), fakeSet)))].sort()
    const binaries = trialBinaries({ binary, needsClaude, needsBrowse, needsMemory: plugin === "mem", scripted, captureServer: options.captureServer, fakeIds, caller })
    await isolation.prepare({ batchRoot, caller, binaries, log })
    if (isolation.confines) facts.isolation_detail = isolation.describe()
    // The harness's scripted model, when asked for: T1's mock server, for the whole batch on loopback, or, in a confined
    // trial, on the trial's own loopback from a read-only copy of the harness's mock files.
    // Either way the provider is the batch's own copy, with its endpoint pinned in a file beside it (read-only inside a
    // container), not in the process environment, which the plugin under test shares and could rewrite before the
    // provider reads it.
    let harnessDir = null
    // The guard is on in every locked trial unless the arm file says `"guard": false` (a probe of the host alone).
    const guardOn = guardWanted ?? (toolsMode === "locked" || holdsCredential)
    if (scripted || guardOn) harnessDir = join(batchRoot, "harness")
    if (scripted) {
      if (!isolation.confines) mock = await startMock({ batchRoot, caller })
      cpSync(resolve(import.meta.dirname, "..", "t1", "mock"), join(harnessDir, "mock"), { recursive: true })
      writeFileSync(join(harnessDir, "mock", "provider", "endpoint.json"), `${JSON.stringify({ url: mock?.url ?? TRIAL_MOCK_URL })}\n`, { mode: 0o444 })
      facts.scripted = true
    }
    if (options.captureServer) {
      // P0-13: only with a dummy credential, never one that reaches anything: the capture server is the model's whole world.
      if (profile.vendor || (profile.kind === "env" && profile.names.some((name) => !/^(CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_AGENT_SDK_VERSION)$/.test(name)))) throw new Error("--capture-server is for the Claude surface probe: no vendor credential")
      harnessDir ??= join(batchRoot, "harness")
      mkdirSync(join(harnessDir, "capture"), { recursive: true })
      cpSync(resolve(import.meta.dirname, "..", "p0", "capture-server.ts"), join(harnessDir, "capture", "capture-server.ts"))
    }
    // Fake mode: the fake MCP server, its fixtures and the catalogs of the fake plugins the cases use, where the trial's container can read them.
    let fake = null
    if (fakeIds.length) {
      harnessDir ??= join(batchRoot, "harness")
      if (!isolation.confines) throw new Error(`fake mode (${fakeIds.join(", ")}) needs --isolation container: it maps the vendor's host name to the fake inside the trial, which an unconfined run cannot do`)
      fake = { ids: fakeIds, ...installFake(harnessDir, fakeIds), rpc: Object.fromEntries(fakeIds.map((id) => [id, loadPacks().find((pack) => pack.id === id).pluginId])) }
      facts.fake_mode = fakeIds
    }
    let probeDir = null
    if (options.probe) {
      // The probe plugin only asks the host about permissions and calls no vendor, but it is for runs whose credentials are dummies: none, or
      // a scratch profile read in standalone mode (EVALS_AUTH_STANDALONE: the enforced-path probe of P0-A2).
      if ((profile.kind !== "none" || profile.vendor) && !(profile.kind === "none" && caller.EVALS_AUTH_STANDALONE)) throw new Error("--probe installs the permission probe plugin and is for runs with no credential")
      harnessDir ??= join(batchRoot, "harness")
      probeDir = join(harnessDir, "probe")
      cpSync(resolve(import.meta.dirname, "probe"), probeDir, { recursive: true })
    }
    let guardDir = null
    if (guardOn) {
      const guardMode = commitPlan ? "commit" : options.guardMode ?? "refuse"
      guardDir = installGuard(harnessDir, buildPolicy({ mode: guardMode, commit: commitPlan?.writes ?? {}, plans: commitPlan?.plans ?? null, locked: toolsMode === "locked", ...(plugin === "mem" ? { memoryBinding: memFixtureBinding(isolation), memoryReplies: options.memoryReplies ?? {} } : {}), ...(options.lockPacks ? { packs: options.lockPacks } : {}) }))
      facts.guard = { mode: guardMode }
    }
    // The probe is a trial of its own: under `container`, it proves a container starts before anything is reserved.
    const probeTrial = await isolation.enter({ name: "probe", sandbox: probe, mounts: [], cwd: probe.home })
    let version
    try {
      const probeSpec = probeTrial.wrap({ command: binary, args: ["--version"], cwd: probe.home, env: probeEnv })
      version = await runToEnd(probeSpec.command, probeSpec.args, { cwd: probeSpec.cwd, env: probeSpec.env, timeoutMs: 30_000 })
    } finally {
      await probeTrial.leave({ reason: "probe" })
    }
    if (version.code !== 0) throw new Error(`${binary} --version failed: is the host installed?${version.stderr ? ` (${tail(version.stderr.trim(), 200)})` : ""}`)
    const opencode = version.stdout.trim()
    const hostVersion = (/(\d+\.\d+\.\d+)/.exec(opencode) ?? [])[1] ?? null
    if (hostVersion && !TESTED.includes(hostVersion)) log(`warning: host ${hostVersion} is not a tested version (${TESTED.join(", ")})`)
    const armDir = armSource ? materialiseArm(resolve(armSource), join(batchRoot, "arm")) : null
    const built = armProvenance(armDir, armSource ? resolve(armSource) : null)
    // The options are an axis of their own: an access mode changes what the plugin allows. Recorded by digest (an
    // option can be a secret), with the access value beside it.
    // Every plugin of a locked trial, the arm and its companions alike, runs at ask-changes with its caps. An explicit
    // access other than ask-changes is refused whenever the run holds any credential; with none, a probe may ask for it.
    const wantsAccess = pluginOptions?.access
    if (toolsMode === "locked" && wantsAccess && wantsAccess !== ACCESS && (profile.kind !== "none" || profile.vendor)) throw new Error(`the arm's options set access ${JSON.stringify(wantsAccess)}: a locked trial that holds a credential runs every plugin at ${ACCESS}`)
    if (toolsMode === "locked" && armDir) pluginOptions = { ...companionOptions(plugin, pluginOptions ?? {}), ...(wantsAccess && profile.kind === "none" && !profile.vendor ? { access: wantsAccess } : {}) }
    const companions = toolsMode === "locked" || companionSpec ? materialiseCompanions(readCompanions(companionSpec, { base: companionBase ?? process.cwd(), exclude: [plugin] }), join(batchRoot, "companions"), { options: (id, extra) => ({ ...companionOptions(id, extra), ...(profile.kind === "none" && !profile.vendor && wantsAccess ? { access: wantsAccess } : {}) }) }) : []
    const arm = { ...built, provenance: { ...built.provenance, options: digestOf(pluginOptions ?? {}), ...(pluginOptions?.access ? { access: pluginOptions.access } : {}), companions: companionsDigest(companions), companion_list: companions.map((c) => `${c.id}@${c.version}`) } }
    Object.assign(facts, { opencode, isolation: isolation.name, ...(isolation.unsafe ? { unsafe_no_isolation: true } : {}), arm: { arm: arm.arm, sha256: arm.sha256, version: arm.version } })

    // The world must be current, and built by the build under test.
    let status = world.status({ arm: armDir ? { dir: armDir, sha256: arm.sha256 } : null })
    if (!status.fresh) {
      if ((options.stale ?? "rebuild") === "rebuild" && typeof world.build === "function" && status.rebuildable !== false) {
        log(`world ${world.name} is stale: ${status.why}`)
        await world.build({ arm: armDir ? { dir: armDir, sha256: arm.sha256 } : null, caller, log })
        status = world.status({ arm: armDir ? { dir: armDir, sha256: arm.sha256 } : null })
      }
      if (!status.fresh) throw new Error(`world ${world.name} is stale and was not rebuilt: ${status.why}`)
    }
    // Every number a selected case was written from must hold in this world, before anything is reserved (HG-14).
    const truth = truthCheck(selected, world)
    if (truth?.bad.length) throw new Error(`the world's truth does not match ${truth.bad.length} claim(s) the cases were written from, so no run was reserved:\n  ${truth.bad.map(renderTruthProblem).join("\n  ")}`)
    if (truth) facts.truth = { claims: truth.rows.length, cases: new Set(truth.rows.map((r) => r.case)).size }

    // A batch must not outlive its sign-in: the worst case is every round of runs hitting the timeout, plus what each
    // run costs around it (world prepare, container setup and teardown, the credential import, the server's start).
    const timeoutMs = Number(options.timeout ?? 420) * 1000
    const overheadMs = runOverheadMs(store, caller)
    const rounds = Math.ceil(jobs.length / parallel)
    const horizonMs = (timeoutMs + overheadMs) * rounds
    facts.horizon = { timeout_s: timeoutMs / 1000, run_overhead_s: overheadMs / 1000, rounds }
    // The integrations a `+profile` batch holds: the arm's plugin and every plugin its cases name in `Seed: plugins=`, by the id
    // each pack gives its integration (the pack's own id unless it says otherwise).
    const packs = loadPacks()
    const named = [...new Set([plugin, ...selected.flatMap((c) => parseSeedList(parseSeed(c.seed).plugins))])]
    const needed = integrationsFor(plugin, selected, packs, (seed) => parseSeedList(parseSeed(seed).plugins), noProfilePlugins({ packs, store }))
    const auth = await prepareAuth(profile, { binary, caller, horizonMs, acceptUnknownExpiry: Boolean(options.acceptUnknownTokenExpiry), needed })
    if (auth.expiry) {
      Object.assign(facts.horizon, auth.expiry)
      log("WARNING: --accept-unknown-token-expiry: the sign-in's expiry is unknown, so this batch is not checked against it; a trial refused authentication stops the batch")
    }
    // From here on, a run's secret (the access token, a key passed through) is scrubbed, by exact value, from every
    // line logged and every file written.
    redact = redactor(auth.secrets)
    registerSecrets(auth.secrets)
    const unscrubbed = log
    log = (line) => unscrubbed(redact(line))
    if (keepRoot && auth.holdsCredential) log(`warning: --keep-credentials: the kept sandboxes under ${batchRoot} hold the imported credential; delete them when you are done`)
    // The model must route inside a trial before anything is reserved: one trial, no prompt, no model call.
    const routeTimeoutMs = Number(caller.EVALS_ROUTE_TIMEOUT_S || 60) * 1000
    const mounts = [armDir, harnessDir, ...companions.map((c) => c.dir)].filter(Boolean).map((host) => ({ host, ro: true }))
    // What the trial's sealed config adds to the arm: its companions, the guard, and the lockdown rules.
    const sealed = {
      companions: companions.map((c) => ({ dir: c.dir, options: c.options })),
      guardDir,
      lockdown: toolsMode === "locked" ? { policies: lockdownPolicies(), permissions: lockdownPermissions({ commit: commitPlan?.actions ?? [], ...(options.noHarnessRules ? { bare: true } : {}), ...(options.noWriteAsks ? { packs: [] } : options.lockPacks ? { packs: options.lockPacks } : {}) }) } : null,
      // Eval-only plugins a probe asks for (src/run/probe): they ask the host about permissions and call no vendor.
      extraPlugins: probeDir ? [probeDir] : [],
      ...(conditionProof ? { condition: options.condition } : {}),
    }
    if (conditionProof) facts.condition = { mode: options.condition, mapping: conditionProof.mapping, qualification_sha256: sha256(readFileSync(options.conditionQualification)) }
    facts.tools = toolsMode
    if (deferred.length) {
      facts.deferred = deferred
      log(`deferred ${deferred.length} case(s): ${deferred.slice(0, 4).map((d) => `${d.case} (${d.why})`).join("; ")}${deferred.length > 4 ? "; …" : ""}`)
    }
    // Owned mode checks routing on the actual fixture/server below, not a replacement preflight server.
    const routed = contained ? { ok: true, waitedMs: null } : await preflightRoute({ fake, batchRoot, isolation, mounts, caller, auth, binary, model: options.model, armDir, options: pluginOptions, scripted, scriptedProvider: scripted && harnessDir ? join(harnessDir, "mock", "provider") : undefined, mockInTrial: scripted && Boolean(harnessDir) && isolation.confines, mockUrl: mock?.url ?? null, harnessDir, bunBinary: caller.EVALS_BUN ?? "bun", routeTimeoutMs, sealed })
    if (!routed.ok) throw new Error(`preflight: the model ${options.model} does not route inside a trial within ${routeTimeoutMs / 1000} s, so no run was reserved. The trial's server lists ${routed.listed.length ? routed.listed.slice(0, 12).join(", ") : "no model"}`)
    facts.preflight = contained ? { model: options.model, status: "deferred-to-contained-trial" } : { model: options.model, routed_after_ms: routed.waitedMs }
    if (!contained) log(`preflight: ${options.model} routes inside a trial (after ${(routed.waitedMs / 1000).toFixed(1)} s)`)
    // Money, then runs: both checked under the ledger's lock before anything launches, and the whole batch reserved in
    // the same step. The dollar caps are the caller's.
    // Every batch's reserved runs count, at the price each was reserved with, before they bill. A batch with no price
    // for its runs cannot be held to the dollar cap: the run caps alone apply to it, and that is said.
    const dollarCaps = budgetCaps(caller)
    const price = projectedRunUsd(store, options.model, caller)
    // The round's list-price ceiling (R9): a model priced at $0 by its subscription is still counted at list price. With a
    // ceiling or cap set, a run with no estimate cannot be held to it and is refused, and so is a batch whose first run
    // would already cross it. The batch reserves its runs at the mean estimate of its tiers; each launch is checked below.
    const roundLimit = roundLimits(store, caller)
    const listInfo = modelPrice(options.model, caller)
    let perRunListUsd = null
    // Fail closed (G0 review 1.3): a model that bills is never launched with no ceiling or cap, and none is launched with no catalogue
    // price, since a run with no list cost would add 0 to what the round has spent.
    const metered = isMetered(options.model)
    if (metered && roundLimit.limit === null) throw new RoundCapError(`no round ceiling or cap is set: cannot hold ${options.model} to anything. Set EVALS_ROUND_CEILING_USD (the phase's) or EVALS_ROUND_CAP_USD / round_cap_usd in caps.json`)
    if (metered && !listInfo.price) throw new RoundCapError(`${roundLimit.binds}: no catalogue price for ${options.model} (${listInfo.why}): a run of it would count as $0. Map it in the model map (EVALS_MODEL_MAP) to a priced model`)
    if (roundLimit.limit !== null) {
      const estimates = jobs.map((job) => estimateRunUsd(store, options.model, tierOf(job.case), caller))
      const missing = estimates.find((e) => e.usd === null)
      if (missing) throw new RoundCapError(`${roundLimit.binds}: cannot hold ${options.model} to $${roundLimit.limit}: ${missing.basis}`)
      perRunListUsd = estimates.reduce((n, e) => n + e.usd, 0) / Math.max(1, estimates.length)
      assertLaunchWithinRound(store, { model: options.model, tier: tierOf(jobs[0].case), running: 0 }, caller)
    }
    // Vendors that bill for reads (R14): each spending plugin the batch names must stay under its written cap, by the ledger's count
    // and, when the caller supplies fetchers, by the vendor's own balance.
    const spenders = named.filter((id) => SPENDING[id])
    if (spenders.length) {
      const capsFileText = existsSync(capsFile(store, caller)) ? JSON.parse(readFileSync(capsFile(store, caller), "utf8")) : {}
      const balances = await checkBalances({ plugins: spenders, runsByPlugin: Object.fromEntries(spenders.map((id) => [id, jobs.length])), ledger: readLedger(store), limits: capsFileText.vendors ?? {}, live: options.balanceFetchers ?? {} })
      for (const line of balances.lines) log(`vendor budget: ${line}`)
      if (!balances.ok) throw new Error(`vendor budget: ${balances.refusals.join("; ")}`)
      facts.vendor_budget = balances.lines
    }
    reservation = reserve(store, { plugin, iteration, runs: jobs.length, model: options.model, env: caller, perRunUsd: price.usd, priceBasis: price.basis, perRunListUsd, vendorPerRun: spenders.length ? Object.fromEntries(spenders.map((id) => [SPENDING[id], perRunWorst(SPENDING[id])])) : null, check: () => assertBatchWithinBudget(store, { runs: jobs.length, perRunUsd: price.usd, basis: price.basis }, caller) })
    facts.round = roundLimit.limit === null ? { enforced: false } : { enforced: true, limit: roundLimit.limit, binds: roundLimit.binds, per_run_list_usd: perRunListUsd, list_price: listInfo.price ? "catalogue" : `none (${listInfo.why})` }
    facts.dollar_cap = price.usd === null ? { enforceable: false, why: price.basis } : { enforceable: true, per_run_usd: price.usd, basis: price.basis }
    log(`reserved ${jobs.length} run(s) as ${reservation.batch}: ${plugin} at ${reservation.used.per_plugin_month + jobs.length}/${caps.per_plugin_month} this month`)
    log(price.usd === null ? `dollar cap: NOT ENFORCEABLE for this batch (${price.basis}); the run caps alone apply` : `dollar cap: $${dollarCaps.model_usd} a month, this batch at $${price.usd.toFixed(4)} a run (${price.basis}); $${reservation.dollars.projected.toFixed(2)} with what is billed and reserved`)

    mkdirSync(rawDir, { recursive: true, mode: 0o700 })
    const ctx = {
      contained,
      store, plugin, iteration, month: reservation.month, batch: reservation.batch, batchRoot, rawDir, binary, opencode, hostVersion,
      model: options.model, options: pluginOptions, timeoutMs: Number(options.timeout ?? 420) * 1000,
      keep: keepRoot, keepCredentials: keepRoot && Boolean(options.keepCredentials), caller, auth, world, armDir, arm, runnerVersion: harnessVersion(),
      worldInfo: { ...(world.provenance?.() ?? { name: world.name }), now: status.now ?? null },
      interrupted: () => interrupted,
      log,
      isolation,
      mockUrl: mock?.url ?? null,
      routeTimeoutMs,
      firstRequestMs: Number(caller.EVALS_FIRST_REQUEST_S || 90) * 1000,
      clientRestarts: retryLimit === 0 ? 0 : Number(caller.EVALS_CLIENT_RESTARTS ?? 1),
      retryLimit,
      scripted,
      mockInTrial: scripted && Boolean(harnessDir) && isolation.confines,
      harnessDir,
      sealed,
      bunBinary: caller.EVALS_BUN ?? "bun",
      nodeBinary: caller.EVALS_NODE ?? "node",
      scriptedProvider: scripted && harnessDir ? join(harnessDir, "mock", "provider") : undefined,
      mounts,
      prompts: gated.prompts,
      captureServer: options.captureServer ?? null,
      fakeSet,
      fake,
      redact,
      dollarCap: facts.dollar_cap,
      listPrice: listInfo.price,
      estimateUsd: (tier) => estimateRunUsd(store, options.model, tier, caller).usd,
    }
    Object.assign(facts, { auth: auth.profile, world: ctx.worldInfo, ...(auth.vendor ? { vendor: auth.vendor } : {}) })
    if (egress && (egress.plugins.length || egress.skipped.length)) facts.egress_plan = { allow: isolationSpec.config?.allow, why: egress.why, plugins: egress.plugins, ...(egress.skipped.length ? { skipped: egress.skipped } : {}) }
    let next = 0
    let running = 0
    let rateStreak = 0
    let pausedUntil = 0
    const worker = async () => {
      for (;;) {
        if (stopped) return
        // Another batch of the wave may have halted it since this one started.
        const marked = readHalt(store)
        if (marked) {
          stopped = haltMessage(marked)
          return
        }
        const index = next++
        if (index >= jobs.length) return
        const job = jobs[index]
        const now = world.status({ arm: armDir ? { dir: armDir, sha256: arm.sha256 } : null })
        if (!now.fresh) {
          results.push({ case: job.case.id, trial: job.trial, skipped: `world stale: ${now.why}` })
          log(`  ${job.case.id}.t${job.trial} SKIPPED: the world went stale (${now.why})`)
          continue
        }
        const window = hourWindow(job.case.seed)
        if (!window.ok) {
          results.push({ case: job.case.id, trial: job.trial, skipped: window.why })
          log(`  ${job.case.id}.t${job.trial} SKIPPED: ${window.why}`)
          continue
        }
        // Before each launch: what the month has billed, plus every other batch's reserved runs, plus what this run
        // and the ones still running are expected to bill, must stay within the cap. A batch stops before it crosses
        // the cap, not after. The expected cost is refreshed from what this month's runs actually billed.
        if (price.usd !== null) {
          const perRun = projectedRunUsd(store, options.model, caller).usd ?? price.usd
          const others = outstanding(readLedger(store).filter((entry) => entry.batch !== reservation.batch)).usd
          const expected = monthToDate(store).model_usd + others + perRun * (running + 1)
          if (expected > dollarCaps.model_usd) {
            stopped = `the next run would take the month's model spend to $${expected.toFixed(2)}, over $${dollarCaps.model_usd}`
            return
          }
        }
        // The round's list-price ceiling, per launch: what the round has spent at list price, with the other batches' reserved
        // runs and this one's runs in flight, plus this run, must stay within the phase ceiling and the hard cap.
        if (roundLimit.limit !== null || metered) {
          try {
            assertLaunchWithinRound(store, { model: options.model, tier: tierOf(job.case), running, batch: reservation.batch }, caller)
          } catch (error) {
            if (!(error instanceof RoundCapError)) throw error
            stopped = error.message
            return
          }
        }
        // The sign-in as it is now: something outside may have rotated it since the last trial. A sign-in that cannot be
        // read is this trial's infra: auth, and no further trial launches; its run goes back to the reserve.
        let trialAuth
        try {
          trialAuth = ctx.auth.forTrial ? ctx.auth.forTrial() : { env: ctx.auth.env, rotated: false }
        } catch (error) {
          results.push({ case: job.case.id, trial: job.trial, infra: "auth", error: redact(String(error.message ?? error)) })
          log(`  ${job.case.id}.t${job.trial} NOT LAUNCHED: infra auth: ${redact(String(error.message ?? error))}`)
          if (!stopped) stopped = `${job.case.id}.t${job.trial}: ${redact(String(error.message ?? error))}; no further trial launched`
          return
        }
        if (trialAuth.rotated) {
          // A new value: scrubbed from here on, from every line logged and every file written.
          registerSecrets([trialAuth.secret])
          redact = redactor(ctx.auth.secrets)
          facts.token_rotations = (facts.token_rotations ?? 0) + 1
          log(`  ${job.case.id}.t${job.trial}: the sign-in was rotated since the last trial; this trial runs on the new one`)
        }
        launched++
        startedJobs.push(job)
        running++
        // A rate-limited run is tried again after 60, 120 and 240 s (R13), and counts as nothing until it ends otherwise; three
        // rate-limited runs in a row, across the batch, pause the model for 30 minutes. Delays scale by EVALS_BACKOFF_SCALE (tests).
        const scale = Number(caller.EVALS_BACKOFF_SCALE ?? 1)
        const nap = (seconds) => new Promise((done) => setTimeout(done, seconds * 1000 * scale))
        let outcome
        for (let attempt = 0; ; attempt++) {
          if (pausedUntil > Date.now()) await new Promise((done) => setTimeout(done, pausedUntil - Date.now()))
          outcome = await runJob({ ...job, attempt, authEnv: trialAuth.env }, ctx).catch((error) => ({ case: job.case.id, trial: job.trial, error: redact(String(error.message ?? error)) }))
          if (!outcome.rateLimited) {
            rateStreak = 0
            break
          }
          rateStreak++
          facts.rate_limited = (facts.rate_limited ?? 0) + 1
          if (rateStreak >= 3) {
            pausedUntil = Date.now() + PAUSE_S * 1000 * scale
            facts.model_paused = (facts.model_paused ?? 0) + 1
            log(`  ${options.model}: three rate-limited runs in a row: paused ${PAUSE_S / 60} min`)
            rateStreak = 0
          }
          log(`  ${job.case.id}.t${job.trial} was rate-limited (attempt ${attempt + 1}): trying again after ${BACKOFF_S[attempt]} s`)
          await nap(BACKOFF_S[attempt])
        }
        running--
        results.push(outcome)
        log(`  [${results.length}/${jobs.length}] ${job.case.id}.t${job.trial} exit=${outcome.exit ?? "?"}${outcome.durationMs ? ` ${Math.round(outcome.durationMs / 1000)}s` : ""}${outcome.infra ? ` INFRA ${outcome.infra}` : ""}${outcome.error ? ` ERROR ${outcome.error}` : ""}`)
        // A write that completed where none may (G0 review 1.1): nothing more launches, in this batch or any other of the wave.
        if (outcome.halt && !facts.halted) {
          const info = { reason: outcome.halt.reason, writes: outcome.halt.writes, batch: reservation.batch, iteration, plugin, model: options.model, trial: `${job.case.id}.t${job.trial}` }
          writeHalt(store, info)
          facts.halted = info
          stopped = `HALT: ${job.case.id}.t${job.trial}: ${outcome.halt.reason}; no further trial launched in any batch (the store's HALT file holds it)`
          log(`  ${stopped}`)
        }
        // The subscription's overage is paid use the round never buys: stop at once (G0 review 1.3).
        if (outcome.overage && !stopped) {
          facts.overage = true
          stopped = `${job.case.id}.t${job.trial} drew on the subscription's overage (isUsingOverage: true): no further trial launched`
        }
        if (outcome.usage_missing) facts.usage_missing = (facts.usage_missing ?? 0) + 1
        // A credential refused once, or a model that does not route, will fail again: no new trial after the first.
        if (outcome.infra === "auth" && !stopped) stopped = `${job.case.id}.t${job.trial} was refused authentication (infra: auth): no further trial launched; refresh the sign-in and rerun the released runs`
        if (outcome.infra === "plugin" && !stopped) stopped = `${job.case.id}.t${job.trial}: a plugin failed to load in the trial (infra: plugin): no further trial launched; its cases would be graded as the model's failure. The host's own log names it in the trial's summary (host_log.plugin_load_failures)`
        if (outcome.infra === "provider" && !stopped) stopped = `${job.case.id}.t${job.trial} never reached its model (infra: provider): no further trial launched; rerun the released runs once the provider routes`
      }
    }
    await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker))
  } finally {
    if (!interrupted) {
      unhook()
      await stop(mock?.proc)
      await isolation.teardown()
      if (isolation.egress?.()) facts.egress = isolation.egress()
      finish(facts, { gone: await isolation.allGone().catch(() => false) })
    }
  }
  const bad = results.filter((r) => r.error || (r.exit !== 0 && r.exit !== undefined))
  log(`done: ${launched} of ${jobs.length} run(s) launched, ${bad.length} with a non-zero exit or an error${stopped ? `; stopped: ${stopped}` : ""}`)
  return { batch: reservation.batch, iteration, plugin, model: options.model, ...facts, trials, cases: selected.map((c) => c.id), planned: jobs.length, launched, stopped, results, bad: bad.length, keptAt: keepRoot ? batchRoot : null }
}
