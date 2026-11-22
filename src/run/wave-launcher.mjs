// Opt-in local supervision. Estimated admission is a target, never a billing guarantee.
import { mkdirSync, writeFileSync, renameSync, rmdirSync, existsSync, readFileSync, realpathSync, readdirSync, lstatSync } from "node:fs"
import { join, resolve, isAbsolute, dirname } from "node:path"
import { randomUUID } from "node:crypto"
import { WAVE_MODEL } from "./wave-manifest.mjs"
import { assertLaunchWithinRound, RoundCapError } from "../cost/budget.mjs"

export const TOTAL_MS = 3600000
export const CLEANUP_MS = 120000
export const CONTEXT = "colima-mem-evals-20261122"
export const systemClock = { monotonic: () => performance.now(), wall: () => Date.now(), sleep: ms => new Promise(done => setTimeout(done, ms)) }
const present = path => { try { lstatSync(path); return true } catch (error) { if (error.code === "ENOENT") return false; throw error } }
export function canonicalPath(path) {
  if (typeof path !== "string" || !isAbsolute(path) || path !== resolve(path)) throw new Error("canonical absolute path required")
  let ancestor = path
  while (!present(ancestor)) ancestor = dirname(ancestor)
  if (realpathSync(ancestor) !== ancestor) throw new Error("symlink path refused")
  return path
}
export function freshWavePaths(wave) {
  for (const key of ["control", "store", "docker_config"]) canonicalPath(wave[key])
  if (!Array.isArray(wave.trials) || !wave.trials.length || wave.trials.some(t => !/^[a-z0-9][a-z0-9-]{0,199}$/.test(t.id ?? "")) || new Set(wave.trials.map(t => t.id)).size !== wave.trials.length) throw new Error("invalid trial paths")
  for (const name of ["resources", "runtime", "manifest.json", "progress.json", "report.json", "worker.json", "wave.json", "wave.lock", "cleanup-clients.json"]) {
    if (present(join(wave.control, name))) throw new Error("pre-existing wave scope refused")
  }
}
export const refusedWave = (wave, reason = "qualification-failed") => ({
  schema: "oc-mem-wave-report/1", wave: wave?.id ?? null, complete: false, stop_reason: reason,
  // Declared tuples remain visible as unqualified data. No paths, cost ledger, or journals are read.
  trials: Array.isArray(wave?.trials) ? wave.trials.map(t => ({ ...t, status: "unrun", reason })) : [],
  cost: null, supervision: { cleanup_verified: true, allocated: false },
})
export function writeJSON(file, data) {
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx", mode: 0o600 })
  renameSync(tmp, file)
}

export function claimWave(control, { manifestSha, store, singleton, start }, clock = systemClock) {
  if (!isAbsolute(control) || !isAbsolute(store) || !/^[a-f0-9]{64}$/.test(manifestSha)) throw new Error("absolute wave control/store and manifest hash required")
  mkdirSync(control, { recursive: true, mode: 0o700 })
  if (realpathSync(control) !== resolve(control)) throw new Error("wave control may not contain symlinks")
  const lock = join(control, "wave.lock")
  if (singleton) {
    if (!isAbsolute(singleton)) throw new Error("absolute singleton lock required")
    try { mkdirSync(singleton, { mode: 0o700 }) } catch { throw new Error("context singleton lock already held") }
  }
  try { mkdirSync(lock, { mode: 0o700 }) } catch { if (singleton) rmdirSync(singleton); throw new Error("wave lock already held; never break an uncertain lock") }
  const started = start?.monotonic ?? clock.monotonic(), started_wall = start?.wall ?? clock.wall(), deadline_wall = started_wall + TOTAL_MS
  try {
    if (existsSync(join(control, "wave.json"))) throw new Error("wave control already used; round restart is forbidden")
    writeFileSync(join(control, "wave.json"), JSON.stringify({ manifest_sha256: manifestSha, store, started_wall, deadline_wall, target_usd: 10, target_not_maximum: true }), { flag: "wx", mode: 0o600 })
  } catch (error) { rmdirSync(lock); if (singleton) rmdirSync(singleton); throw error }
  let elapsed = 0
  return { control, started, started_wall, deadline_wall, elapsed: () => (elapsed = Math.max(elapsed, clock.monotonic() - started, clock.wall() - started_wall, 0)), release: verified => { if (verified) { rmdirSync(lock); if (singleton) rmdirSync(singleton) } } }
}

/** Runs in the parent, never in the runner event loop. The adapter owns one fresh detached group. */
export async function superviseGroup(lease, { child, alive, signal, cleanup, stopRequested = () => null }, clock = systemClock) {
  let reason
  for (;;) {
    if (stopRequested()) { reason = "signal"; break }
    if (lease.elapsed() >= TOTAL_MS - CLEANUP_MS) { reason = "local-timeout"; break }
    if (child.finished()) { reason = "finished"; break }
    if (child.exited()) { reason = "worker-exited"; break }
    await clock.sleep(Math.min(100, TOTAL_MS - CLEANUP_MS - lease.elapsed()))
  }
  let groupGone = false, resourcesGone = false
  try {
    if (alive(child.pgid)) signal(child.pgid, "SIGTERM")
    const escalateAt = Math.min(lease.elapsed() + 10000, TOTAL_MS)
    while (alive(child.pgid) && lease.elapsed() < escalateAt) await clock.sleep(Math.min(100, escalateAt - lease.elapsed()))
    if (alive(child.pgid)) signal(child.pgid, "SIGKILL")
    const verifyAt = Math.min(lease.elapsed() + 10000, TOTAL_MS)
    while (alive(child.pgid) && lease.elapsed() < verifyAt) await clock.sleep(Math.min(100, verifyAt - lease.elapsed()))
    groupGone = !alive(child.pgid)
    // Never remove a resource while a still-running creator can replace the ownership journal.
    if (groupGone && lease.elapsed() < TOTAL_MS) resourcesGone = await cleanup(() => Math.max(0, TOTAL_MS - lease.elapsed()))
  } catch { /* Ownership/daemon/OS uncertainty is a failed cleanup, not permission to sweep. */ }
  return { reason, group_gone: groupGone, cleanup_verified: groupGone && resourcesGone && lease.elapsed() < TOTAL_MS, elapsed_ms: lease.elapsed(), deadline_exceeded: lease.elapsed() >= TOTAL_MS, remote_cancellation_guaranteed: false }
}

const resourceScopes = new WeakMap()
export function createResourceScope(control, { manifestSha, trials }) {
  canonicalPath(control)
  if (!/^[a-f0-9]{64}$/.test(manifestSha) || !Array.isArray(trials) || trials.some(t => !/^[a-z0-9][a-z0-9-]{0,199}$/.test(t.id ?? "")) || new Set(trials.map(t => t.id)).size !== trials.length) throw new Error("invalid resource scope identity")
  const directory = join(control, "resources")
  mkdirSync(directory, { mode: 0o700 }) // EEXIST, including symlinks, never grants ownership.
  const stat = lstatSync(directory)
  const scope = Object.freeze({ directory, owner: Object.freeze({ invocation_id: randomUUID(), manifest_sha256: manifestSha }) })
  resourceScopes.set(scope, { stat, trials: trials.map(t => t.id) })
  return scope
}
const sameOwner = (actual, scope, id) => actual?.invocation_id === scope.owner.invocation_id && actual.manifest_sha256 === scope.owner.manifest_sha256 && actual.trial_id === id
export async function cleanupOwned(scope, execDocker, remaining) {
  const authority = resourceScopes.get(scope)
  if (!authority) return false
  try {
    canonicalPath(scope.directory)
    const stat = lstatSync(scope.directory)
    if (stat.dev !== authority.stat.dev || stat.ino !== authority.stat.ino || !stat.isDirectory()) return false
  } catch { return false }
  let verified = true
  for (const id of authority.trials) {
    const file = join(scope.directory, `${id}.json`), started = join(scope.directory, `${id}.started.json`)
    if (!present(file)) { if (present(started)) verified = false; continue }
    try { canonicalPath(file); if (!lstatSync(file).isFile()) throw new Error("not a receipt file") } catch { verified = false; continue }
    let journal
    try { journal = JSON.parse(readFileSync(file, "utf8")) } catch { verified = false; continue }
    if (!sameOwner(journal.owner, scope, id)) { verified = false; continue }
    if (journal.schema !== "oc-evals-owned/1" || !/^b[a-f0-9]{10}$/.test(journal.batch ?? "") || !Array.isArray(journal.resources) || !Array.isArray(journal.pending) || typeof journal.uncertain !== "boolean") { verified = false; continue }
    if (journal.resources.some(r => !["container", "network"].includes(r.kind) || !/^[a-f0-9]{64}$/.test(r.id ?? ""))) { verified = false; continue }
    if (journal.uncertain || journal.pending.length) verified = false
    if (journal.verified_gone === true && !journal.uncertain && !journal.pending.length) continue
    for (const kind of ["container", "network"]) for (const resource of journal.resources.filter(r => r.kind === kind)) {
      if (remaining() <= 0) return false
      const prefix = ["--context", CONTEXT]
      await execDocker([...prefix, ...(kind === "container" ? ["rm", "-f", "-v"] : ["network", "rm"]), resource.id], Math.min(20000, remaining()))
      if (remaining() <= 0) return false
      const result = await execDocker([...prefix, ...(kind === "network" ? ["network"] : []), "inspect", "--format", "{{.Id}}", resource.id], Math.min(10000, remaining()))
      if (result.code !== 1 || !/no such/i.test(result.stderr ?? "")) verified = false
    }
  }
  return verified
}

export const iterationOf = (wave, trial) => `${wave.id}-${trial.id}`
export function trialCleanupVerified(wave, trial, owner) {
  try {
    if (!/^[a-z0-9][a-z0-9-]{0,199}$/.test(trial.id) || !/^[a-f0-9-]{36}$/.test(owner?.invocation_id ?? "") || !/^[a-f0-9]{64}$/.test(owner?.manifest_sha256 ?? "")) return false
    const file = canonicalPath(join(wave.control, "resources", `${trial.id}.json`))
    if (!lstatSync(file).isFile()) return false
    const journal = JSON.parse(readFileSync(file, "utf8"))
    return sameOwner(journal.owner, { owner }, trial.id) && journal.schema === "oc-evals-owned/1" && /^b[a-f0-9]{10}$/.test(journal.batch ?? "") && journal.verified_gone === true && journal.uncertain === false && Array.isArray(journal.pending) && journal.pending.length === 0 && Array.isArray(journal.resources) && journal.resources.every(r => ["container", "network"].includes(r.kind) && /^[a-f0-9]{64}$/.test(r.id ?? ""))
  } catch { return false }
}
export function trialComplete(wave, trial, owner) {
  try {
    const dir = join(wave.store, "raw", iterationOf(wave, trial), "mem")
    const summary = JSON.parse(readFileSync(join(dir, `${trial.case}.t1.summary.json`), "utf8"))
    const files = readdirSync(dir).filter(name => /^batch-.*\.json$/.test(name))
    if (files.length !== 1) return false
    const batch = JSON.parse(readFileSync(join(dir, files[0]), "utf8"))
    const good = r => r?.case === trial.case && r.trial === 1 && r.exit === 0 && !r.incomplete && !r.infra && !r.error && !r.usage_missing
    return !batch.containers_left && good(summary) && summary.model === WAVE_MODEL && batch.model === WAVE_MODEL && batch.planned === 1 && batch.launched === 1 && batch.cases?.length === 1 && batch.cases[0] === trial.case && batch.results?.length === 1 && good(batch.results[0]) && trialCleanupVerified(wave, trial, owner)
  } catch { return false }
}
export function trialCommand(wave, trial, casePlan, harness, remainingMs, caller) {
  if (typeof caller.OPENCODE_API_KEY !== "string" || !caller.OPENCODE_API_KEY.trim()) throw new Error("OPENCODE_API_KEY is required")
  if (JSON.stringify(wave).includes(caller.OPENCODE_API_KEY)) throw new Error("credential value must not occur in wave inputs")
  const timeout = Math.min(wave.trial_timeout_s, Math.floor(remainingMs / 1000))
  if (!(timeout >= 1)) throw new Error("no work time remains")
  const runtime = join(wave.control, "runtime"), home = join(runtime, "home")
  return {
    command: wave.runtime.launcher_node.path,
    args: [join(harness, "bin/evals"), "run", "--plugin", "mem", "--iteration", iterationOf(wave, trial), "--model", WAVE_MODEL, "--auth", "env:OPENCODE_API_KEY", "--cases", trial.case, "--cases-dir", wave.cases_dir, "--set", casePlan.set, "--trials", "1", "--parallel", "1", "--arm", wave.arms[trial.arm].directory, "--world", join(harness, "worlds/mem/index.mjs"), "--host", "2.2.6", "--timeout", String(timeout), "--stale", "refuse", "--tools", "locked", "--isolation", "container", "--harness-retries", "0", "--process-group", "inherited", "--condition", trial.condition, "--condition-qualification", wave.arms[trial.arm].conditions.path],
    env: {
      PATH: caller.PATH ?? "/usr/bin:/bin", HOME: home, TMPDIR: join(runtime, "tmp"), XDG_CONFIG_HOME: join(home, ".config"), XDG_CACHE_HOME: join(home, ".cache"), XDG_DATA_HOME: join(home, ".local/share"), XDG_STATE_HOME: join(home, ".local/state"),
      OPENCODE_API_KEY: caller.OPENCODE_API_KEY,
      EVALS_STORE: wave.store, EVALS_TMP: join(runtime, "sandboxes"), EVALS_CAPS: wave.caps.path, EVALS_MODELS_CATALOG: wave.catalog.path,
      EVALS_ROUND_CAP_USD: "10", EVALS_ROUND_CEILING_USD: "10", EVALS_CONTAINER_MAX_PARALLEL: "1", EVALS_CONTAINER_SWEEP_SCOPE: "own",
      EVALS_CONTAINER_OWNERSHIP: join(wave.control, "resources", `${trial.id}.json`), EVALS_CONTAINER_IMAGE: wave.runtime.image,
      ...(caller.MEM_WAVE_OWNER ? { EVALS_CONTAINER_OWNER: JSON.stringify({ ...JSON.parse(caller.MEM_WAVE_OWNER), trial_id: trial.id }) } : {}),
      EVALS_DOCKER: wave.runtime.docker.path, DOCKER_CONFIG: wave.docker_config, DOCKER_CONTEXT: CONTEXT,
      OPENCODE_BIN_2_2_6: wave.runtime.opencode.path, EVALS_OPENCODE_BIN: wave.runtime.opencode.path, EVALS_NODE: wave.runtime.node.path, EVALS_PROXY_NODE: wave.runtime.node.path,
    },
  }
}

function ledgerRows(store) {
  const file = join(store, "ledger/runs.jsonl")
  if (!existsSync(file)) return []
  const rows = readFileSync(file, "utf8").split("\n").filter(Boolean).map(line => JSON.parse(line))
  for (const row of rows) for (const field of ["billed_usd", "list_usd", "known_billed_usd", "known_list_usd"]) if (row[field] !== null && row[field] !== undefined && (typeof row[field] !== "number" || !Number.isFinite(row[field]) || row[field] < 0)) throw new Error("invalid cost ledger")
  return rows
}

export function waveCost(wave, trials) {
  const all = ledgerRows(wave.store).filter(e => e.kind === "run")
  const started = trials.filter(t => t.status !== "unrun")
  const rows = all.filter(e => started.some(t => e.iteration === iterationOf(wave, t)))
  const known_list_usd = rows.reduce((n, e) => n + (e.known_list_usd ?? e.list_usd ?? 0), 0)
  const known_billed_usd = rows.reduce((n, e) => n + (e.known_billed_usd ?? e.billed_usd ?? 0), 0)
  const unresolved_trials = started.filter(t => {
    const matches = rows.filter(e => e.iteration === iterationOf(wave, t))
    return t.status === "incomplete" || matches.length !== 1 || matches.some(e => e.attempt_complete !== true || e.case !== t.case || e.trial !== 1 || e.model !== WAVE_MODEL || e.list_usd == null || e.billed_usd == null || e.usage_missing || e.billed_incomplete)
  }).map(t => t.id)
  return { known_list_usd, known_billed_usd, actual_list_usd: unresolved_trials.length ? null : known_list_usd, actual_billed_usd: unresolved_trials.length ? null : known_billed_usd, unresolved_trials, overshoot_usd: Math.max(0, known_list_usd - 10), overshoot_is_lower_bound: unresolved_trials.length > 0, round_known_list_usd: all.reduce((n, e) => n + (e.known_list_usd ?? e.list_usd ?? 0), 0) }
}

export function initialReport(wave) {
  return { schema: "oc-mem-wave-report/1", wave: wave.id, target_usd: 10, target_not_maximum: true, remote_cancellation_guaranteed: false, stop_reason: null, trials: wave.trials.map(t => ({ ...t, status: "unrun", reason: "not-started" })), cost: null }
}

/** Sequential CLI boundary. Verification and admission finish before a single child is started. */
export async function runTrials(wave, plan, { harness, caller, lease, verify, execute, save, stopRequested = () => false }) {
  if (!caller.OPENCODE_API_KEY?.trim()) throw new Error("OPENCODE_API_KEY is required")
  if (JSON.stringify(wave).includes(caller.OPENCODE_API_KEY)) throw new Error("credential value must not occur in wave inputs")
  const report = initialReport(wave)
  save(report)
  for (const trial of report.trials) {
    if (stopRequested()) { report.stop_reason = "signal"; break }
    if (lease.elapsed() >= TOTAL_MS - CLEANUP_MS) { report.stop_reason = "local-timeout"; break }
    const c = plan.cases.find(c => c.id === trial.case)
    let spec
    try {
      await verify()
      ledgerRows(wave.store) // Unlike the legacy ledger reader, corrupt input cannot silently disappear.
      spec = trialCommand(wave, trial, c, harness, TOTAL_MS - CLEANUP_MS - lease.elapsed(), caller)
      assertLaunchWithinRound(wave.store, { model: WAVE_MODEL, tier: c.tier ?? "wide", running: 0 }, spec.env)
    } catch (error) {
      report.stop_reason = error instanceof RoundCapError ? "budget-admission" : "qualification-failed"
      break
    }
    if (stopRequested() || lease.elapsed() >= TOTAL_MS - CLEANUP_MS) { report.stop_reason = stopRequested() ? "signal" : "local-timeout"; break }
    trial.status = "running"; trial.reason = null; save(report)
    try {
      const result = await execute(spec, trial)
      report.cost = waveCost(wave, report.trials)
      const complete = result.code === 0 && result.complete === true && trialComplete(wave, trial, caller.MEM_WAVE_OWNER ? JSON.parse(caller.MEM_WAVE_OWNER) : null) && !report.cost.unresolved_trials.includes(trial.id)
      trial.status = complete ? "completed" : "incomplete"
      trial.reason = complete ? null : "trial-failed-or-unresolved"
      if (!complete) report.stop_reason = trial.reason
    } catch { trial.status = "incomplete"; trial.reason = "trial-failed-or-unresolved"; report.stop_reason = trial.reason }
    save(report)
    if (report.stop_reason) break
  }
  for (const trial of report.trials) if (trial.status === "unrun") trial.reason = report.stop_reason ?? "not-started"
  try { report.cost = waveCost(wave, report.trials) } catch { report.cost = { unresolved: true }; report.stop_reason ??= "invalid-cost-ledger" }
  save(report)
  return report
}

/** Parent adapter is the only owner allowed to signal the worker's exclusive process group. */
export async function launchWave(wave, { manifestSha, singleton, verify, allocate = () => {}, spawnWorker, alive, signal, cleanup, stopRequested, clock = systemClock }) {
  const start = { monotonic: clock.monotonic(), wall: clock.wall() }
  try { freshWavePaths(wave); await verify() } catch { return refusedWave(wave) }
  if (stopRequested?.() || Math.max(clock.monotonic() - start.monotonic, clock.wall() - start.wall) >= TOTAL_MS - CLEANUP_MS) return refusedWave(wave, stopRequested?.() ? "signal" : "local-timeout")
  const lease = claimWave(wave.control, { manifestSha, store: wave.store, singleton, start }, clock)
  let child, scope, supervision, report = initialReport(wave)
  const finalFile = join(wave.control, "report.json")
  writeJSON(finalFile, report)
  try {
    scope = createResourceScope(wave.control, { manifestSha, trials: wave.trials })
    await allocate(lease, scope)
    if (lease.elapsed() >= TOTAL_MS - CLEANUP_MS || stopRequested?.()) throw new Error("no work time")
    child = spawnWorker(lease, scope)
    writeJSON(join(wave.control, "worker.json"), { pgid: child.pgid, started_wall: clock.wall(), manifest_sha256: manifestSha })
    child.activate?.()
    supervision = await superviseGroup(lease, { child, alive, signal, cleanup: remaining => cleanup(remaining, scope), stopRequested }, clock)
  } catch {
    if (child) supervision = await superviseGroup(lease, { child, alive, signal, cleanup: remaining => cleanup(remaining, scope), stopRequested: () => true }, clock)
    else {
      let clean = !scope
      try { if (scope) clean = lease.elapsed() < TOTAL_MS && await cleanup(() => Math.max(0, TOTAL_MS - lease.elapsed()), scope) } catch { /* retain locks on uncertainty */ }
      supervision = { reason: "qualification-failed", cleanup_verified: clean && lease.elapsed() < TOTAL_MS, group_gone: true }
    }
  }
  try {
    const saved = JSON.parse(readFileSync(join(wave.control, "progress.json"), "utf8"))
    if (saved.wave !== wave.id || saved.trials?.length !== wave.trials.length || saved.trials.some((t, i) => t.id !== wave.trials[i].id)) throw new Error("invalid progress")
    report = saved
  } catch { /* Keep the complete initial manifest when the worker never wrote progress. */ }
  report.stop_reason ??= supervision.reason === "finished" ? null : supervision.reason
  for (const trial of report.trials) {
    if (trial.status === "running") { trial.status = "incomplete"; trial.reason = report.stop_reason ?? "interrupted" }
    if (trial.status === "unrun") trial.reason = report.stop_reason ?? "not-started"
  }
  try { report.cost = waveCost(wave, report.trials) } catch { report.cost = { unresolved: true } }
  report.supervision = supervision
  report.complete = supervision.cleanup_verified && report.trials.every(t => t.status === "completed") && report.cost?.unresolved_trials?.length === 0
  writeJSON(finalFile, report)
  lease.release(supervision.cleanup_verified)
  return report
}
