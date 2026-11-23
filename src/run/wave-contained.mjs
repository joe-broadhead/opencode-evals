// Parent-only composition. No runtime capability is discovered from a manifest or environment.
import { containTrial } from "./owned-containment.mjs"
import { createOwnedDockerClient } from "./owned-docker-client.mjs"
import { createOwnedDockerProcess } from "./owned-docker-process.mjs"
import { validateOwnedInputs, measureOwnedWork, createBoundedReader } from "./owned-io.mjs"
import { finalizeOwnedTrial } from "./owned-postmortem.mjs"
import { WAVE_MODEL } from "./wave-manifest.mjs"
import { assertLaunchWithinRound, RoundCapError } from "../cost/budget.mjs"

const WORK_MS = 3480000, TOTAL_MS = 3600000, OP_MS = 20000
// Containment diagnostics can originate in callbacks. Public reports are a closed local schema.
const LOCAL_REASONS = new Set(["cancelled", "trial-timeout", "disk-limit", "disk-unknown", "creation_unknown", "config_rejected", "inputs_rejected", "proxy-network", "proxy-start", "proxy-readiness", "start_unknown", "final-config-rejected", "worker_exit_unknown", "finalization_unknown"])
const publicReason = reason => reason === null ? null : LOCAL_REASONS.has(reason) ? reason : "contained-operation-unavailable"
function nativeFacts(read) {
  let known = null
  return binding => {
    try {
      const value = read?.({ ...binding })
      if (typeof value?.then === "function") {
        // Unsupported async results supply no facts, but their rejection must be observed.
        Promise.resolve(value).catch(() => {})
      } else if (["failed", "interrupted"].includes(value?.outcome) && Object.keys(binding).every(key => value.binding?.[key] === binding[key])) {
        known = { binding: { ...binding }, outcome: value.outcome }
      }
    } catch { /* Native lookup failure cannot suppress independent fixed-reader recovery. */ }
    return known
  }
}
const alive = (lease, current, stop) => current() && !stop() && lease.elapsed() < WORK_MS
async function boundedSnapshot(read, request, lease, clock) {
  const end = Math.min(WORK_MS, lease.elapsed() + OP_MS)
  let timer
  try {
    const value = await Promise.race([Promise.resolve().then(() => read(request)), new Promise((_, reject) => { timer = clock.set(() => reject(new Error("snapshot timeout")), end - lease.elapsed()) })])
    if (lease.elapsed() >= end) throw new Error("snapshot timeout")
    return structuredClone(value)
  } finally { clock.clear(timer) }
}

/** Snapshot is a private injected approval interface, not a JSON manifest option.
 * It attests the selected tuple's fixed staged trees against the exact manifest/harness.
 * The fixed validator rehashes those trees. The native transport is composed only through
 * the dispatch-time qualification binding; without a matched owner record nothing native
 * is constructed and this composition refuses before any Docker spawn.
 */
export async function runOwnedWave(wave, report, { owned, caller, lease, clock, verify, scopeCurrent, journalFor, stopRequested, signal, save, readCost, native = null }) {
  let cleanup = true, attempted = false
  // The dispatch-time qualification binding is the only source of execution_qualified:
  // it reports true only when a matched binding actually admitted this run's native
  // dispatch. The run journal records the validation outcome and, on a match, the profile.
  report.execution_qualified = false
  report.native_qualification = native?.matched === true
    ? { matched: true, profile: native.profile }
    : { matched: false, reason: native?.reason ?? "native-qualification-not-bound" }
  report.complete = false
  report.successor_allowed = false
  const admit = c => {
    readCost() // A corrupt aggregate ledger never disappears from budget admission.
    assertLaunchWithinRound(wave.store, { model: WAVE_MODEL, tier: c.tier ?? "wide", running: 0 }, { EVALS_CAPS: wave.caps.path, EVALS_ROUND_CAP_USD: "10", EVALS_ROUND_CEILING_USD: "10" })
  }
  // A matched binding composes the reviewed owned process transport: the qualified reader
  // is that transport's identityOwner. An unmatched binding never dispatches natively.
  const dispatchSpawn = plan => {
    if (native?.matched !== true || !native.identityOwner) throw new Error("native dispatch refused: qualification binding absent")
    return createOwnedDockerProcess({ binary: wave.runtime.docker.path, config: wave.docker_config, context: plan.context, plan, credentialValues: { OPENCODE_API_KEY: caller.OPENCODE_API_KEY } }, { spawn: owned.spawn, identityOwner: native.identityOwner }).spawn
  }
  for (const trial of report.trials) {
    let journal, result
    try {
      if (!alive(lease, scopeCurrent, stopRequested)) throw new Error("admission closed")
      const qualified = await verify(), c = qualified.plan?.cases.find(c => c.id === trial.case)
      if (!c) throw new Error("case unavailable")
      admit(c)
      if (!alive(lease, scopeCurrent, stopRequested)) throw new Error("admission closed")
      journal = journalFor(trial)
      const snapshot = await boundedSnapshot(owned.snapshot, { manifestSha: journal.owner.manifest_sha256, harnessSha: wave.harness_sha, trial: structuredClone(trial) }, lease, clock)
      if (snapshot.manifest_sha256 !== journal.owner.manifest_sha256 || snapshot.harness_sha !== wave.harness_sha || snapshot.trial_id !== trial.id || snapshot.image !== wave.runtime.image) throw new Error("snapshot identity mismatch")
      await verify() // Snapshot acquisition can yield. Recheck the frozen manifest before dispatch.
      admit(c)
      // Selection/configuration never comes from writable output or snapshot-supplied runner options.
      // The lease reads fractional milliseconds (performance.now()); the owned plan's
      // validator requires safe-integer bounds, so both are floored like the legacy
      // trialCommand. Flooring cannot lengthen a bound past its integer ceiling.
      const timeoutMs = Math.floor(Math.min(wave.trial_timeout_s * 1000, WORK_MS - lease.elapsed()))
      const plan = { binding: journal.owner, context: "colima-mem-evals-20261122", control: wave.control, store: wave.store, dockerConfig: wave.docker_config,
        ...Object.fromEntries(["work", "inputs", "binaries", "architecture", "inputs_sha256", "binaries_sha256", "image", "imageEnv", "user", "allow"].map(k => [k, snapshot[k]])),
        credentialNames: ["OPENCODE_API_KEY"], timeoutMs, cleanupMs: Math.floor(Math.min(120000, TOTAL_MS - lease.elapsed() - timeoutMs)), operationMs: OP_MS, outputBytes: 1048576,
        descriptor: { options: { plugin: "mem", iteration: `${wave.id}-${trial.id}`, model: WAVE_MODEL, auth: "env:OPENCODE_API_KEY", cases: trial.case, casesDir: "/inputs/cases", set: c.set, trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: Math.floor(timeoutMs / 1000), stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited", condition: trial.condition, conditionQualification: "/inputs/conditions.json" } } }
      if (!alive(lease, scopeCurrent, stopRequested)) throw new Error("admission closed")
      const docker = createOwnedDockerClient({ binary: wave.runtime.docker.path, context: plan.context, config: wave.docker_config, credentialValues: { OPENCODE_API_KEY: caller.OPENCODE_API_KEY } }, { spawn: dispatchSpawn(plan), clock })
      journal.started(lease.elapsed() + plan.timeoutMs + plan.cleanupMs)
      attempted = true; trial.status = "running"; trial.reason = null
      report.execution_qualified = native?.matched === true
      save(report)
      const abort = new AbortController()
      const cancel = () => abort.abort()
      signal?.addEventListener("abort", cancel, { once: true })
      let monitor
      const watch = () => {
        if (signal?.aborted || !alive(lease, scopeCurrent, stopRequested)) cancel()
        else monitor = clock.set(watch, Math.min(100, WORK_MS - lease.elapsed()))
      }
      watch()
      const nativeSnapshot = nativeFacts(owned.nativeSnapshot)
      try {
        result = await containTrial(plan, { docker, clock, signal: abort.signal, journal: journal.write,
          validateInputs: p => validateOwnedInputs(p, owned.io), measure: owned.measure ?? measureOwnedWork,
          nativeSnapshot,
          finalize: (proof, { secrets }) => finalizeOwnedTrial(proof, {
            read: createBoundedReader(plan.work, proof.inputs.work, owned.io), secrets: [caller.OPENCODE_API_KEY, ...secrets], price: snapshot.price ?? null,
            nativeSnapshot: nativeSnapshot(proof.binding),
          }),
        })
      } finally { clock.clear(monitor); signal?.removeEventListener("abort", cancel); journal.close() }
      cleanup = result.cleanup_verified === true && result.host_clients_closed === true && !journal.failed() && scopeCurrent() && lease.elapsed() < TOTAL_MS
      // Preserve partial cost and native negatives, never import child data into the aggregate ledger.
      trial.containment = { cleanup_verified: cleanup, host_clients_closed: result.host_clients_closed, creation_unknown: result.creation_unknown,
        native: result.native, observer: result.observer, evidence: result.evidence, accounting: result.accounting, worker_exit: result.worker_exit,
        complete: false, successor_allowed: false, reason: publicReason(result.reason) }
      trial.status = "incomplete"; trial.reason = "native-acceptance-unqualified"
      report.stop_reason = trial.reason
    } catch (error) {
      if (attempted || journal?.failed()) cleanup = false
      trial.status = attempted ? "incomplete" : "unrun"
      trial.reason = error instanceof RoundCapError ? "budget-admission" : "contained-admission-or-execution-unavailable"
      report.stop_reason = trial.reason
    } finally { journal?.close() }
    // P-F is deliberately absent. No provisional result, even a clean one, permits a successor.
    break
  }
  for (const trial of report.trials) if (trial.status === "unrun") trial.reason = report.stop_reason ?? "not-started"
  try { report.cost = readCost() } catch { report.cost = { unresolved: true } }
  report.supervision = { kind: "owned-container", cleanup_verified: cleanup && scopeCurrent(), elapsed_ms: lease.elapsed(), remote_cancellation_guaranteed: false }
  report.reservation_retained = attempted || !report.supervision.cleanup_verified
  save(report)
  return report
}
