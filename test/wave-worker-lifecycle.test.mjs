import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { main } from "../scripts/run-mem-wave.mjs"
import { WAVE_MODEL, sha256 } from "../src/run/wave-manifest.mjs"
import { recordRun } from "../src/cost/ledger.mjs"

const json = (file, value) => writeFileSync(file, JSON.stringify(value))

// Actual serialized-worker entrypoint, with only its external channel/runtime replaced.
// No duplicated stop callback: main must install and pass its production lifetime guard.
async function workerScenario(t, mode) {
  const root = mkdtempSync(join(tmpdir(), "wave-worker-lifetime-")), control = join(root, "control")
  t.after(() => rmSync(root, { recursive: true, force: true }))
  mkdirSync(join(control, "resources"), { recursive: true })
  const plan = { cases: [{ id: "a", set: "tune", tier: "wide" }] }
  const wave = { id: "lifetime", model: WAVE_MODEL, control, store: join(root, "store"), docker_config: root, cases_dir: root,
    trial_timeout_s: 10, caps: { path: join(root, "caps.json") }, catalog: { path: "/fake" },
    runtime: Object.fromEntries(["launcher_node", "docker", "node", "opencode"].map(k => [k, { path: "/fake" }])),
    arms: { baseline: { directory: "/fake", conditions: { path: "/fake" } } },
    trials: ["first", "second"].map(id => ({ id, case: "a", arm: "baseline", condition: "direct" })) }
  const manifest = join(root, "manifest.json"), bytes = JSON.stringify(wave), manifestSha = sha256(bytes)
  writeFileSync(manifest, mode === "bad-json" ? "null" : bytes)
  json(wave.caps.path, { estimate_run_usd: { [WAVE_MODEL]: { wide: 0.1 } } })
  json(join(control, "wave.json"), { manifest_sha256: manifestSha, store: wave.store, started_wall: 0 })
  const owner = { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: manifestSha }
  const descriptors = Object.fromEntries(["connected", "send", "disconnect"].map(key => [key, Object.getOwnPropertyDescriptor(process, key)]))
  const events = ["message", "disconnect", "SIGINT", "SIGTERM"]
  const listeners = Object.fromEntries(events.map(event => [event, process.rawListeners(event)]))
  let attempts = 0, requests = 0, qualifications = 0, report, error
  const disconnect = () => { process.connected = false; process.emit("disconnect") }
  process.connected = mode !== "unconnected"
  process.disconnect = disconnect
  process.send = (message, callback) => {
    requests++
    assert.equal(process.connected, true, "no request on a lost channel")
    assert.equal(message.type, "verify-trial")
    if (requests === 2 && mode === "send-error") return callback(new Error("synthetic send failure"))
    if (requests === 2 && mode === "pending-disconnect") return disconnect()
    process.emit("message", { type: "trial-verification", trial_id: message.trial_id, verified: true })
    // Response and disconnect both occur before the awaiting continuation, as in the independent reproduction.
    if (requests === 2 && ["post-positive", "post-positive-rebound"].includes(mode)) {
      disconnect()
      if (mode === "post-positive-rebound") process.connected = true
    }
    if (requests === 2 && mode === "unhealthy-after-positive") process.connected = false
  }
  try {
    const pending = main(["--worker", manifest], {
      env: { OPENCODE_API_KEY: "synthetic-only", MEM_WAVE_MANIFEST_SHA: manifestSha, MEM_WAVE_OWNER: JSON.stringify(owner) },
      clock: { wall: () => 0, monotonic: () => 0 }, identity: () => ({}),
      qualify: () => {
        qualifications++
        if (mode === "qualification-error") throw new Error("synthetic qualification failure")
        if (qualifications === 3 && ["qualification-disconnect", "qualification-rebound", "qualification-unhealthy"].includes(mode)) {
          if (mode === "qualification-unhealthy") process.connected = false
          else disconnect()
          if (mode === "qualification-rebound") process.connected = true
        }
        return { execution_qualified: true, plan }
      },
      adapter: { supervisionAvailable: true, trial: async () => {
        attempts++
        assert.equal(process.connected, true, "no workload after channel loss")
        if (mode === "trial-error") throw new Error("synthetic adapter failure")
        const trial = wave.trials[attempts - 1], raw = join(wave.store, "raw", `lifetime-${trial.id}`, "mem"), result = { case: "a", trial: 1, exit: 0 }
        mkdirSync(raw, { recursive: true })
        json(join(raw, "a.t1.summary.json"), { ...result, model: WAVE_MODEL })
        json(join(raw, "batch-test.json"), { model: WAVE_MODEL, planned: 1, launched: 1, cases: ["a"], results: [result] })
        json(join(control, "resources", `${trial.id}.json`), { schema: "oc-evals-owned/1", batch: "b1234567890", owner: { ...owner, trial_id: trial.id }, resources: [], pending: [], uncertain: false, verified_gone: true })
        // Synthetic terminal rows isolate admission; the real producer remains unqualified.
        recordRun(wave.store, { iteration: `lifetime-${trial.id}`, model: WAVE_MODEL, case: "a", trial: 1, billed_usd: 0.1, list_usd: 0.1, attempt_complete: true })
        return { code: 0 }
      } },
    })
    if (mode === "before-start") disconnect()
    else {
      process.emit("message", { type: mode === "invalid-start" ? "invalid" : "start" })
      if (mode === "after-start") disconnect()
    }
    try { report = await pending } catch (failure) { error = failure }
    for (const event of events) assert.deepEqual(process.rawListeners(event), listeners[event], `${mode}: no retained ${event} listener`)
  } finally {
    // Restore the test host even on red; cleanup is not a substitute for the assertions above.
    for (const event of events) for (const listener of process.rawListeners(event)) if (!listeners[event].includes(listener)) process.removeListener(event, listener)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (descriptor) Object.defineProperty(process, key, descriptor)
      else delete process[key]
    }
  }
  return { attempts, requests, report, error }
}

test("worker lifetime: initial qualification channel loss admits zero attempts, even after rebound", async t => {
  for (const mode of ["after-start", "qualification-disconnect", "qualification-rebound", "qualification-unhealthy"]) {
    const result = await workerScenario(t, mode)
    assert.equal(result.error, undefined)
    assert.equal(result.attempts, 0, mode)
    assert.equal(result.requests, 0, mode)
    assert.equal(result.report.trials.every(t => t.status === "unrun"), true)
  }
})

test("worker lifetime: positive successor reply followed by loss admits only one attempt", async t => {
  for (const mode of ["post-positive", "post-positive-rebound", "unhealthy-after-positive"]) {
    const result = await workerScenario(t, mode)
    assert.equal(result.error, undefined)
    assert.equal(result.attempts, 1, mode)
    assert.equal(result.requests, 2)
    assert.equal(result.report.trials[1].status, "unrun")
  }
})

test("worker lifetime: callback error or disconnect during verification admits no successor", async t => {
  for (const mode of ["send-error", "pending-disconnect"]) {
    const result = await workerScenario(t, mode)
    assert.equal(result.error, undefined)
    assert.equal(result.attempts, 1)
    assert.equal(result.report.trials[1].status, "unrun")
  }
})

test("worker lifetime: startup and qualification errors remove all lifecycle listeners", async t => {
  for (const mode of ["unconnected", "before-start", "invalid-start", "bad-json", "qualification-error"]) {
    const result = await workerScenario(t, mode)
    assert.ok(result.error, mode)
    assert.equal(result.attempts, 0)
  }
})

test("worker lifetime: connected completion and adapter failure both remove lifecycle listeners", async t => {
  const normal = await workerScenario(t, "normal")
  assert.equal(normal.error, undefined)
  assert.equal(normal.attempts, 2)
  assert.equal(normal.requests, 3)
  assert.equal(normal.report.stop_reason, null)
  const failed = await workerScenario(t, "trial-error")
  assert.equal(failed.error, undefined)
  assert.equal(failed.attempts, 1)
  assert.equal(failed.report.trials[1].status, "unrun")
})
