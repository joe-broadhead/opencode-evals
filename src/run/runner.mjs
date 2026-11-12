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

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { freePort } from "../t1/http.mjs"
import { stockBinary, TESTED } from "../t1/harness.mjs"
import { selectCases } from "../case/sets.mjs"
import { pluginCases } from "../case/load.mjs"
import { harnessVersion } from "../version.mjs"
import { reserve, release, recordRun, readLedger, loadCaps, checkCaps, monthOf, outstanding } from "../cost/ledger.mjs"
import { assertBatchWithinBudget, projectedRunUsd, monthToDate, budgetCaps } from "../cost/budget.mjs"
import { pluginRepo } from "../pack/from-plugin.mjs"
import { rawRoot, storeRoot } from "../store.mjs"
import { makeSandbox, sealedConfig, sandboxEnv, newPassword, writeConfig, start, runToEnd, stop, removeSandbox, killAll, stripForeignLinks, SCRIPTED_MODEL } from "./sandbox.mjs"
import { parseAuth, prepareAuth } from "./auth.mjs"
import { loadWorld, parseSeed } from "./world.mjs"
import { materialiseArm, armProvenance } from "./arm.mjs"
import { snapshotFiles, changedFiles } from "./files.mjs"
import { segment, within } from "./paths.mjs"
import { selectIsolation, isLive } from "./isolation.mjs"
import { redactor, scrubTree } from "./secrets.mjs"
import { splitTrial } from "../grade/trials.mjs"
import { digestOf } from "../util/canonical.mjs"
import { dirname } from "node:path"


export const RUNNER = "evals run"

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

/** Starts one host server on a free port, and retries on another when the port was taken in between. */
async function startServer({ binary, cwd, env, password, wrap = (spec) => spec, timeoutMs = 60_000 }) {
  const auth = `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`
  let last = ""
  for (let attempt = 0; attempt < 3; attempt++) {
    const port = await freePort()
    const spec = wrap({ command: binary, args: ["serve", "--hostname", "127.0.0.1", "--port", String(port)], cwd, env })
    const proc = start(spec.command, spec.args, { cwd: spec.cwd, env: spec.env })
    let exited = false
    proc.exited.then(() => (exited = true))
    const deadline = Date.now() + timeoutMs
    while (!exited && Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/agent`, { headers: { authorization: auth, "x-opencode-directory": cwd }, signal: AbortSignal.timeout(2000) })
        if (response.ok) return { proc, url: `http://127.0.0.1:${port}`, port }
        last = `HTTP ${response.status}`
      } catch (error) {
        last = String(error.message ?? error)
      }
      await new Promise((done) => setTimeout(done, 200))
    }
    last = exited ? `the server exited: ${proc.output().stderr.slice(-300)}` : `no answer in ${timeoutMs} ms (${last})`
    await stop(proc, { graceMs: 500 })
  }
  throw new Error(`the host server did not start: ${last}`)
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

/** Removes every sandbox's copy of the sign-in under a batch directory. */
function scrubCredentials(batchRoot) {
  const runs = join(batchRoot, "runs")
  if (!existsSync(runs)) return
  for (const name of readdirSync(runs)) rmSync(join(runs, name, "home", ".claude", ".credentials.json"), { force: true })
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
  const config = sealedConfig({ armDir: ctx.armDir, options: ctx.options, model: ctx.model, scripted: Boolean(ctx.mockUrl) })
  writeConfig(sandbox, config)
  const password = newPassword()
  const env = sandboxEnv({ sandbox, config, password, caller: ctx.caller, extra: { ...ctx.auth.env, ...(prepared.env ?? {}), ...(ctx.mockUrl ? { SPIKE_MOCK_URL: ctx.mockUrl } : {}) } })
  // Every host command of the run goes through the isolation backend.
  const wrap = (spec) => ctx.isolation.wrap({ ...spec, sandbox })
  const exec = (args, options = {}) => {
    const spec = wrap({ command: ctx.binary, args, cwd: options.cwd ?? cwd, env: options.env ?? env })
    return runToEnd(spec.command, spec.args, { ...options, cwd: spec.cwd, env: spec.env })
  }
  try {
    await ctx.auth.apply({ sandbox, env, exec })
    const before = snapshotFiles(cwd)
    const started = Date.now()
    let server = null
    let result
    try {
      server = await startServer({ binary: ctx.binary, cwd, env, password, wrap })
      // `Seed: continue=<key>` continues a session the world holds, in the sandbox's own copy of it.
      const session = prepared.session ? ["--session", prepared.session] : ["--title", `eval ${id} t${job.trial}`]
      result = await exec(["run", "--server", server.url, "--format", "json", "-m", ctx.model, ...session, job.case.prompt], { timeoutMs: ctx.timeoutMs })
    } catch (error) {
      result = { code: null, stdout: "", stderr: String(error.message ?? error), timedOut: false, error: String(error.message ?? error) }
    } finally {
      await stop(server?.proc)
    }
    // An interrupted run is not a recording: nothing is written for it, and the batch's own cleanup removes its sandbox.
    if (ctx.interrupted()) throw new Error(`interrupted by ${ctx.interrupted()}`)
    const durationMs = Date.now() - started
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
      stderr: `${result.stderr ?? ""}${result.timedOut ? `\n[evals run] killed after ${ctx.timeoutMs} ms` : ""}`.slice(-4000),
      started_at: new Date(started).toISOString(),
      runner: RUNNER,
      runner_version: ctx.runnerVersion,
      opencode: ctx.opencode,
      host: ctx.hostVersion,
      auth: ctx.auth.profile,
      isolation: ctx.isolation.name,
      ...(ctx.isolation.unsafe ? { unsafe_no_isolation: true } : {}),
      world: ctx.worldInfo,
      batch: ctx.batch,
      dollar_cap: ctx.dollarCap,
      provenance: ctx.arm.provenance,
      ...(result.error ? { error: result.error } : {}),
    }
    // Every file written for the run is scrubbed of its secrets first: the recording, the summary, the files record.
    const out = (suffix) => within(ctx.rawDir, join(ctx.rawDir, `${name}${suffix}`), "a recording")
    writeAtomic(out(".jsonl"), ctx.redact(result.stdout ?? ""))
    writeAtomic(out(".summary.json"), ctx.redact(`${JSON.stringify(summary, null, 1)}\n`))
    writeAtomic(out(".files.json"), ctx.redact(`${JSON.stringify(changedFiles(before, cwd), null, 1)}\n`))
    if (!ctx.keep) removeSandbox(within(ctx.batchRoot, root, "the sandbox"))
    const cost = billedOf(result.stdout ?? "")
    recordRun(ctx.store, { batch: ctx.batch, month: ctx.month, iteration: ctx.iteration, plugin: ctx.plugin, model: ctx.model, case: id, trial: job.trial, exit: summary.exit, duration_ms: durationMs, ...cost })
    return { case: id, trial: job.trial, exit: summary.exit, durationMs, ...(result.error ? { error: ctx.redact(result.error) } : {}) }
  } finally {
    // A credentials file goes on every path, a run that failed, threw or was interrupted included; a kept sandbox
    // keeps no secret.
    ctx.auth.cleanup({ sandbox })
    if (ctx.keep) scrubTree(root, ctx.redact)
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
  const scripted = Boolean(options.scripted)
  if (scripted && options.model !== SCRIPTED_MODEL) throw new Error(`--scripted runs the harness's scripted model, ${SCRIPTED_MODEL}: --model ${options.model} is not it`)
  const live = isLive({ auth: profile.kind, model: options.model, config: sealedConfig({ armDir: null, model: options.model, scripted }) })
  const isolationSpec = { name: options.isolation ?? caller.EVALS_ISOLATION ?? "none", live, unsafe: Boolean(options.unsafeNoIsolation) }
  if (options.dryRun) {
    log(`evals run: ${plugin} ${iteration}  ${selected.length} case(s) x ${trials} trial(s) = ${jobs.length} run(s)  model ${options.model}  parallel ${parallel}`)
    let refused = false
    try {
      const isolation = selectIsolation(isolationSpec)
      log(`isolation: ${isolation.name}${isolation.unsafe ? " (UNSAFE: the filesystem is not confined)" : ""}${live ? "" : " (not live: the scripted model, no credential)"}`)
    } catch (error) {
      refused = true
      log(`dry run: the batch would be refused: ${error.message}`)
    }
    if (!refused) log(`world: ${(await loadWorld(options.world ?? caller[`EVALS_WORLD_${plugin.toUpperCase()}`] ?? null)).name}`)
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

  // No live run without a backend that confines the filesystem, unless the caller says so in so many words.
  const isolation = selectIsolation(isolationSpec)
  if (isolation.unsafe) log("WARNING: --unsafe-no-isolation: the agent under test can read and write anything this user can, by absolute path")
  const world = await loadWorld(options.world ?? caller[`EVALS_WORLD_${plugin.toUpperCase()}`] ?? null)
  log(`evals run: ${plugin} ${iteration}  ${selected.length} case(s) x ${trials} trial(s) = ${jobs.length} run(s)  model ${options.model}  parallel ${parallel}  world ${world.name}`)
  // A kept sandbox keeps the credential imported into it: only when asked for in so many words.
  if (options.keep && profile.kind === "claude-agent" && !options.keepCredentials) throw new Error("--keep with --auth claude-agent keeps the imported credential in the sandboxes: add --keep-credentials to mean it")

  const tmpRoot = resolve(caller.EVALS_TMP ?? tmpdir())
  const batchRoot = within(tmpRoot, mkdtempSync(join(tmpRoot, `evals-run-${iteration}-`)), "the batch directory")

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
  const finish = (facts = {}) => {
    if (finished) return
    finished = true
    if (reservation) release(store, reservation.batch, jobs.length - launched)
    // No sign-in file outlives the batch, and a kept batch directory holds no secret, whatever path ended the batch.
    scrubCredentials(batchRoot)
    if (keepRoot) scrubTree(batchRoot, redact)
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
    try {
      finish(facts)
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
    await isolation.prepare({ batchRoot, caller })
    // The harness's scripted model, when asked for: T1's mock server on loopback, for the whole batch.
    if (scripted) {
      mock = await startMock({ batchRoot, caller })
      facts.scripted = true
    }
    const probeSpec = isolation.wrap({ command: binary, args: ["--version"], cwd: probe.home, env: probeEnv, sandbox: probe })
    const version = await runToEnd(probeSpec.command, probeSpec.args, { cwd: probeSpec.cwd, env: probeSpec.env, timeoutMs: 30_000 })
    if (version.code !== 0) throw new Error(`${binary} --version failed: is the host installed?`)
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

    // A batch must not outlive its sign-in: the worst case is every round of runs hitting the timeout.
    const timeoutMs = Number(options.timeout ?? 420) * 1000
    const horizonMs = timeoutMs * Math.ceil(jobs.length / parallel)
    const auth = await prepareAuth(profile, { binary, caller, horizonMs })
    // From here on, a run's secret (the access token, a key passed through) is scrubbed, by exact value, from every
    // line logged and every file written.
    redact = redactor(auth.secrets)
    const unscrubbed = log
    log = (line) => unscrubbed(redact(line))
    if (keepRoot && auth.holdsCredential) log(`warning: --keep-credentials: the kept sandboxes under ${batchRoot} hold the imported credential; delete them when you are done`)
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
        log(`  [${results.length}/${jobs.length}] ${job.case.id}.t${job.trial} exit=${outcome.exit ?? "?"}${outcome.durationMs ? ` ${Math.round(outcome.durationMs / 1000)}s` : ""}${outcome.error ? ` ERROR ${outcome.error}` : ""}`)
      }
    }
    await Promise.all(Array.from({ length: Math.min(parallel, jobs.length) }, worker))
  } finally {
    if (!interrupted) {
      unhook()
      await stop(mock?.proc)
      await isolation.teardown()
      finish(facts)
    }
  }
  const bad = results.filter((r) => r.error || (r.exit !== 0 && r.exit !== undefined))
  log(`done: ${launched} of ${jobs.length} run(s) launched, ${bad.length} with a non-zero exit or an error${stopped ? `; stopped: ${stopped}` : ""}`)
  return { batch: reservation.batch, iteration, plugin, model: options.model, ...facts, trials, cases: selected.map((c) => c.id), planned: jobs.length, launched, stopped, results, bad: bad.length, keptAt: keepRoot ? batchRoot : null }
}
