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
import { assertBatchWithinBudget, projectedRunUsd, monthToDate, budgetCaps } from "../cost/budget.mjs"
import { pluginRepo } from "../pack/from-plugin.mjs"
import { rawRoot, storeRoot } from "../store.mjs"
import { makeSandbox, sealedConfig, sandboxEnv, worldEnv, newPassword, writeConfig, start, runToEnd, stop, removeSandbox, removeInside, killAll, stripForeignLinks, SCRIPTED_MODEL } from "./sandbox.mjs"
import { parseAuth, prepareAuth, readCredential, unknownExpiry } from "./auth.mjs"
import { loadWorld, parseSeed } from "./world.mjs"
import { checkTruth, renderTruthProblem } from "../case/truth.mjs"
import { AUTH_ERROR, endedOnAuth } from "./authError.mjs"
import { materialiseArm, armProvenance } from "./arm.mjs"
import { snapshotFiles, changedFiles } from "./files.mjs"
import { segment, within, inside } from "./paths.mjs"
import { selectIsolation, isLive, defaultIsolation } from "./isolation.mjs"
import { containerConfig, findBinary, markBatchDir } from "./container.mjs"
import { redactor, scrubTree, registerSecrets, tail } from "./secrets.mjs"
import { splitTrial } from "../grade/trials.mjs"
import { digestOf } from "../util/canonical.mjs"
import { dirname } from "node:path"


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

/** "auth", "provider", or null: a failure before the model did any work, which is never the model's to be graded on. */
export const preModelFailure = (result) => (authFailed(result) ? "auth" : providerFailed(result) ? "provider" : null)

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
  const config = sealedConfig({ armDir: p.armDir, options: p.options, model: p.model, scripted: p.scripted, scriptedProvider: p.scriptedProvider })
  writeConfig(sandbox, config)
  const password = newPassword()
  registerSecrets([password])
  const trial = await p.isolation.enter({ name: "preflight", sandbox, mounts: p.mounts, cwd: sandbox.project })
  let server = null
  let mock = null
  try {
    if (p.scripted && p.mockInTrial) mock = await startTrialMock({ trial, ctx: p, sandbox })
    const mockUrl = mock?.url ?? p.mockUrl
    const env = sandboxEnv({ sandbox, config, password, caller: p.caller, extra: { ...p.auth.env, ...(mockUrl ? { SPIKE_MOCK_URL: mockUrl } : {}) } })
    const exec = (args, options = {}) => {
      const spec = trial.wrap({ command: p.binary, args, cwd: options.cwd ?? sandbox.project, env: options.env ?? env })
      return runToEnd(spec.command, spec.args, { ...options, cwd: spec.cwd, env: spec.env })
    }
    await p.auth.apply({ sandbox, env, exec })
    server = await startServer({ binary: p.binary, cwd: sandbox.project, env, password, trial })
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
  for (let attempt = 0; attempt < 3; attempt++) {
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
  const spec = trial.wrap({ command: ctx.bunBinary, args: [join(ctx.harnessDir, "mock", "server.ts"), String(MOCK_PORT), join(sandbox.tmp, "mock.jsonl")], cwd: sandbox.tmp, env: { HOME: sandbox.tmp, TMPDIR: sandbox.tmp } })
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

/** T1's scripted model server, started for a batch: the harness's own mock, never a model. */
async function startMock({ batchRoot, caller }) {
  const port = await freePort()
  const home = join(batchRoot, "mock")
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const proc = start(caller.EVALS_BUN ?? "bun", [resolve(import.meta.dirname, "..", "t1", "mock", "server.ts"), String(port), join(home, "mock.jsonl")], { cwd: home, env: { PATH: caller.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: home } })
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

async function runJob(job, ctx) {
  const id = segment("case id", job.case.id)
  const name = `${id}.t${job.trial}`
  // Every path this run writes or removes is checked against the root it belongs to.
  const root = within(join(ctx.batchRoot, "runs"), join(ctx.batchRoot, "runs", name), "the sandbox")
  const sandbox = makeSandbox(root)
  const prepared = await ctx.world.prepare({ sandbox, case: job.case, seed: job.case.seed ?? null, trial: job.trial, caller: ctx.caller })
  const cwd = within(root, prepared.cwd, "the working directory")
  const cut = stripForeignLinks(sandbox)
  if (cut.length) ctx.log(`  ${name}: removed ${cut.length} link(s) out of the sandbox that the world's home carried (${cut.slice(0, 3).join(", ")})`)
  const config = sealedConfig({ armDir: ctx.armDir, options: ctx.options, model: ctx.model, scripted: Boolean(ctx.scripted), scriptedProvider: ctx.scriptedProvider })
  writeConfig(sandbox, config)
  const password = newPassword()
  // This run's secrets: the batch's (the access token, a key passed through) and its own server password.
  const redact = redactor([...(ctx.auth.secrets ?? []), password])
  registerSecrets([password])
  let trial = null
  let gone = false
  try {
    // The trial: under `container`, its own container and network, with the sandbox mounted at its own path.
    trial = await ctx.isolation.enter({ name, sandbox, mounts: ctx.mounts, cwd })
    let mock = null
    if (ctx.scripted && ctx.mockInTrial) mock = await startTrialMock({ trial, ctx, sandbox })
    const mockUrl = mock?.url ?? ctx.mockUrl
    // A world's own variables go in first and never the sealed ones; the harness's (credential, endpoint) go in last.
    const fromWorld = worldEnv(prepared.env)
    if (fromWorld.dropped.length) ctx.log(`  ${name}: the world's env may not set ${fromWorld.dropped.join(", ")}: ignored`)
    const env = sandboxEnv({ sandbox, config, password, caller: ctx.caller, world: fromWorld.env, extra: { ...ctx.auth.env, ...(mockUrl ? { SPIKE_MOCK_URL: mockUrl } : {}) } })
    // Every host command of the run goes through the trial.
    const exec = (args, options = {}) => {
      const spec = trial.wrap({ command: ctx.binary, args, cwd: options.cwd ?? cwd, env: options.env ?? env })
      return runToEnd(spec.command, spec.args, { ...options, cwd: spec.cwd, env: spec.env })
    }
    await ctx.auth.apply({ sandbox, env, exec })
    const before = snapshotFiles(cwd)
    const started = Date.now()
    let server = null
    let result
    try {
      server = await startServer({ binary: ctx.binary, cwd, env, password, trial })
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
        result = await exec(["run", "--server", server.url, "--format", "json", "-m", ctx.model, ...session, job.case.prompt], { timeoutMs: ctx.timeoutMs })
      }
    } catch (error) {
      result = { code: null, stdout: "", stderr: String(error.message ?? error), timedOut: false, error: String(error.message ?? error) }
    } finally {
      await stop(server?.proc)
      await stop(mock?.proc, { graceMs: 200 })
    }
    // Killing a `docker exec` client leaves what it started running inside: the trial ends here, before anything of
    // its sandbox is read, so nothing it left behind can change the files being recorded.
    const oomKills = await trial.oomKills()
    await trial.leave({ reason: result.timedOut ? "timeout" : "end" })
    // An interrupted run is not a recording: nothing is written for it, and the batch's own cleanup removes its sandbox.
    if (ctx.interrupted()) throw new Error(`interrupted by ${ctx.interrupted()}`)
    const durationMs = Date.now() - started
    const detail = trial.describe()
    const killed = trial.killed
    const summary = {
      exit: result.timedOut ? 124 : result.code,
      durationMs,
      trial: job.trial,
      case: id,
      arm: ctx.arm.arm,
      model: ctx.model,
      seed: job.case.seed ?? null,
      utc_hour: new Date(started).getUTCHours(),
      ...(prepared.session ? { continued: true } : {}),
      // Scrubbed, then cut: a secret straddling the cut would leave its tail in the summary otherwise.
      stderr: redact(`${result.stderr ?? ""}${result.timedOut ? `\n[evals run] killed after ${ctx.timeoutMs} ms` : ""}${killed ? `\n[evals run] killed: ${killed.reason}` : ""}`).slice(-4000),
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
    const files = inside(root, cwd) ? changedFiles(before, cwd) : []
    if (!inside(root, cwd)) summary.files_refused = "the working directory no longer resolves inside the sandbox"
    // Every file written for the run is scrubbed of its secrets first: the recording, the summary, the files record.
    const out = (suffix) => within(ctx.rawDir, join(ctx.rawDir, `${name}${suffix}`), "a recording")
    writeAtomic(out(".jsonl"), redact(result.stdout ?? ""))
    writeAtomic(out(".summary.json"), redact(`${JSON.stringify(summary, null, 1)}\n`))
    writeAtomic(out(".files.json"), redact(`${JSON.stringify(files, null, 1)}\n`))
    // Only once the trial is confirmed gone is its sandbox touched: removed, or kept and scrubbed.
    gone = await trial.gone()
    if (!gone) ctx.log(`  ${name}: the trial's container is still there: its sandbox is kept, not removed`)
    if (!ctx.keep && gone) removeSandbox(within(ctx.batchRoot, root, "the sandbox"))
    const cost = billedOf(result.stdout ?? "")
    if (summary.infra) {
      // Not a run of the model: its reservation goes back, so it can be rerun from the reserve.
      release(ctx.store, ctx.batch, 1)
      return { case: id, trial: job.trial, exit: summary.exit, durationMs, infra: summary.infra, ...(result.error ? { error: redact(result.error) } : {}) }
    }
    recordRun(ctx.store, { batch: ctx.batch, month: ctx.month, iteration: ctx.iteration, plugin: ctx.plugin, model: ctx.model, case: id, trial: job.trial, exit: summary.exit, duration_ms: durationMs, ...cost })
    return { case: id, trial: job.trial, exit: summary.exit, durationMs, ...(killed ? { killed: killed.reason } : {}), ...(result.error ? { error: redact(result.error) } : {}) }
  } finally {
    // The trial ends on every path (idempotent); a credentials file goes on every path, a run that failed, threw or was
    // interrupted included; a kept sandbox keeps no secret.
    await trial?.leave({ reason: "finally" })
    if (trial && !gone) gone = await trial.gone()
    ctx.auth.cleanup({ sandbox, gone: trial ? gone : true })
    if (ctx.keep && (gone || !trial)) scrubTree(root, redact)
  }
}

/**
 * The whole batch. `options` mirrors the CLI flags; `caller` is the environment the runner was started with.
 */
export async function runBatch(options, { caller = process.env, log = (line) => console.log(line) } = {}) {
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
  // The repository's cases and the store's private holdouts, or exactly the directory --cases-dir names.
  const caseList = pluginCases(plugin, { dir: options.casesDir ?? null, env: caller })
  if (!caseList.length) throw new Error(`no compiled cases for ${plugin}${options.casesDir ? ` in ${options.casesDir}` : ""}`)
  const { selected } = selectCases(caseList, { patterns: options.cases ?? "*", set: options.set ?? "tune" })
  const rawDir = within(rawRoot(caller), join(rawRoot(caller), iteration, plugin), "the recordings directory")
  const jobs = plan({ cases: selected, trials, recorded: recordedTrials(rawDir), append: Boolean(options.append) })

  // An arm is a built plugin directory, `none`, or a JSON file naming one and the options it runs with:
  //   { "package": "../opencode-history", "options": { "access": "ask-changes" } }
  let armSpec = options.arm
  let pluginOptions = options.options ? JSON.parse(options.options) : null
  if (armSpec && armSpec !== "none" && armSpec.endsWith(".json")) {
    const manifest = JSON.parse(readFileSync(armSpec, "utf8"))
    if (pluginOptions && manifest.options) throw new Error(`${armSpec} sets options; --options would override them: pass one`)
    pluginOptions = pluginOptions ?? manifest.options ?? null
    armSpec = manifest.package === "none" ? "none" : resolve(dirname(resolve(armSpec)), manifest.package)
  }
  const armSource = armSpec === "none" ? null : armSpec ?? pluginRepo(plugin, caller)
  if (armSpec !== "none" && !armSource) throw new Error(`no build for ${plugin}: pass --arm <built plugin dir> (or none), or set EVALS_REPO_${plugin.toUpperCase()} or EVALS_PLUGIN_ROOT`)
  const binary = hostBinary({ host: options.host, env: caller })
  const caps = loadCaps(store, caller)
  const month = monthOf()

  // Live or not is decided by what the run would be given: a credential, and the config the harness seals. Only the
  // harness's own scripted model with no credential is not live. Decided, and refused, before a world module is
  // imported: importing one runs its code.
  const profile = parseAuth(options.auth ?? caller.EVALS_AUTH)
  // A key passed through is a secret from the start: a world build's error output is scrubbed of it too.
  if (profile.kind === "env") registerSecrets(profile.names.map((name) => caller[name]))
  const scripted = Boolean(options.scripted)
  if (scripted && options.model !== SCRIPTED_MODEL) throw new Error(`--scripted runs the harness's scripted model, ${SCRIPTED_MODEL}: --model ${options.model} is not it`)
  const live = isLive({ auth: profile.kind, model: options.model, config: sealedConfig({ armDir: null, model: options.model, scripted }) })
  // Every run is confined in a container unless the caller names another backend: the scripted model can call tools too.
  const isolationName = options.isolation ?? (caller.EVALS_ISOLATION || null) ?? defaultIsolation()
  const isolationSpec = { name: isolationName, live, unsafe: Boolean(options.unsafeNoIsolation), config: isolationName === "container" ? containerConfig({ store, env: caller }) : null }
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
  const batchRoot = within(tmpRoot, mkdtempSync(join(tmpRoot, `evals-run-${iteration}-`)), "the batch directory")
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
  let keepRoot = Boolean(options.keep)
  const facts = {}
  let mock = null
  let redact = redactor([])
  const finish = (facts = {}, { gone = true } = {}) => {
    if (finished) return
    finished = true
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
    log(`evals run: ${stopped}; stopping every run this batch started`)
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
    uncaughtException: (error) => {
      log(`evals run: ${error?.stack ?? error}`)
      onInterrupt("an uncaught error", 1)
    },
    unhandledRejection: (error) => {
      log(`evals run: ${error?.stack ?? error}`)
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
    // The binaries a trial needs, mounted read-only into a container: the host, a provider's own CLI, the mock's bun.
    const needsClaude = profile.kind === "claude-agent" || options.model.startsWith("claude-agent/")
    const binaries = { opencode: binary, ...(needsClaude ? { claude: caller.EVALS_CLAUDE_BIN ?? "claude" } : {}), ...(scripted ? { bun: caller.EVALS_BUN ?? "bun" } : {}) }
    await isolation.prepare({ batchRoot, caller, binaries, log })
    if (isolation.confines) facts.isolation_detail = isolation.describe()
    // The harness's scripted model, when asked for: T1's mock server, for the whole batch on loopback, or, in a confined
    // trial, on the trial's own loopback from a read-only copy of the harness's mock files.
    // Either way the provider is the batch's own copy, with its endpoint pinned in a file beside it (read-only inside a
    // container), not in the process environment, which the plugin under test shares and could rewrite before the
    // provider reads it.
    let harnessDir = null
    if (scripted) {
      if (!isolation.confines) mock = await startMock({ batchRoot, caller })
      harnessDir = join(batchRoot, "harness")
      cpSync(resolve(import.meta.dirname, "..", "t1", "mock"), join(harnessDir, "mock"), { recursive: true })
      writeFileSync(join(harnessDir, "mock", "provider", "endpoint.json"), `${JSON.stringify({ url: mock?.url ?? TRIAL_MOCK_URL })}\n`, { mode: 0o444 })
      facts.scripted = true
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
    const arm = { ...built, provenance: { ...built.provenance, options: digestOf(pluginOptions ?? {}), ...(pluginOptions?.access ? { access: pluginOptions.access } : {}) } }
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
    const auth = await prepareAuth(profile, { binary, caller, horizonMs, acceptUnknownExpiry: Boolean(options.acceptUnknownTokenExpiry) })
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
    const mounts = [armDir, harnessDir].filter(Boolean).map((host) => ({ host, ro: true }))
    const routed = await preflightRoute({ batchRoot, isolation, mounts, caller, auth, binary, model: options.model, armDir, options: pluginOptions, scripted, scriptedProvider: harnessDir ? join(harnessDir, "mock", "provider") : undefined, mockInTrial: Boolean(harnessDir) && isolation.confines, mockUrl: mock?.url ?? null, harnessDir, bunBinary: caller.EVALS_BUN ?? "bun", routeTimeoutMs })
    if (!routed.ok) throw new Error(`preflight: the model ${options.model} does not route inside a trial within ${routeTimeoutMs / 1000} s, so no run was reserved. The trial's server lists ${routed.listed.length ? routed.listed.slice(0, 12).join(", ") : "no model"}`)
    facts.preflight = { model: options.model, routed_after_ms: routed.waitedMs }
    log(`preflight: ${options.model} routes inside a trial (after ${(routed.waitedMs / 1000).toFixed(1)} s)`)
    // Money, then runs: both checked under the ledger's lock before anything launches, and the whole batch reserved in
    // the same step. The dollar caps are the caller's.
    // Every batch's reserved runs count, at the price each was reserved with, before they bill. A batch with no price
    // for its runs cannot be held to the dollar cap: the run caps alone apply to it, and that is said.
    const dollarCaps = budgetCaps(caller)
    const price = projectedRunUsd(store, options.model, caller)
    reservation = reserve(store, { plugin, iteration, runs: jobs.length, model: options.model, env: caller, perRunUsd: price.usd, priceBasis: price.basis, check: () => assertBatchWithinBudget(store, { runs: jobs.length, perRunUsd: price.usd, basis: price.basis }, caller) })
    facts.dollar_cap = price.usd === null ? { enforceable: false, why: price.basis } : { enforceable: true, per_run_usd: price.usd, basis: price.basis }
    log(`reserved ${jobs.length} run(s) as ${reservation.batch}: ${plugin} at ${reservation.used.per_plugin_month + jobs.length}/${caps.per_plugin_month} this month`)
    log(price.usd === null ? `dollar cap: NOT ENFORCEABLE for this batch (${price.basis}); the run caps alone apply` : `dollar cap: $${dollarCaps.model_usd} a month, this batch at $${price.usd.toFixed(4)} a run (${price.basis}); $${reservation.dollars.projected.toFixed(2)} with what is billed and reserved`)

    mkdirSync(rawDir, { recursive: true, mode: 0o700 })
    const ctx = {
      store, plugin, iteration, month: reservation.month, batch: reservation.batch, batchRoot, rawDir, binary, opencode, hostVersion,
      model: options.model, options: pluginOptions, timeoutMs: Number(options.timeout ?? 420) * 1000,
      keep: keepRoot, keepCredentials: keepRoot && Boolean(options.keepCredentials), caller, auth, world, armDir, arm, runnerVersion: harnessVersion(),
      worldInfo: { ...(world.provenance?.() ?? { name: world.name }), now: status.now ?? null },
      interrupted: () => interrupted,
      log,
      isolation,
      mockUrl: mock?.url ?? null,
      routeTimeoutMs,
      scripted,
      mockInTrial: Boolean(harnessDir) && isolation.confines,
      harnessDir,
      bunBinary: caller.EVALS_BUN ?? "bun",
      scriptedProvider: harnessDir ? join(harnessDir, "mock", "provider") : undefined,
      mounts: [armDir, harnessDir].filter(Boolean).map((host) => ({ host, ro: true })),
      redact,
      dollarCap: facts.dollar_cap,
    }
    Object.assign(facts, { auth: auth.profile, world: ctx.worldInfo })
    let next = 0
    let running = 0
    const worker = async () => {
      for (;;) {
        if (stopped) return
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
        launched++
        running++
        const outcome = await runJob(job, ctx).catch((error) => ({ case: job.case.id, trial: job.trial, error: redact(String(error.message ?? error)) }))
        running--
        results.push(outcome)
        log(`  [${results.length}/${jobs.length}] ${job.case.id}.t${job.trial} exit=${outcome.exit ?? "?"}${outcome.durationMs ? ` ${Math.round(outcome.durationMs / 1000)}s` : ""}${outcome.infra ? ` INFRA ${outcome.infra}` : ""}${outcome.error ? ` ERROR ${outcome.error}` : ""}`)
        // A credential refused once, or a model that does not route, will fail again: no new trial after the first.
        if (outcome.infra === "auth" && !stopped) stopped = `${job.case.id}.t${job.trial} was refused authentication (infra: auth): no further trial launched; refresh the sign-in and rerun the released runs`
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
