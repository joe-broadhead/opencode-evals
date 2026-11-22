import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, renameSync, existsSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { completeTrials, WAVE_MODEL } from "../src/run/wave-manifest.mjs"
import { launchWave, runTrials, cleanupOwned, writeJSON, createResourceScope, trialCleanupVerified } from "../src/run/wave-launcher.mjs"
import { processAdapter, requestTrialVerification } from "../src/run/wave-process.mjs"
import { recordRun } from "../src/cost/ledger.mjs"

test("worker admission uses the parent's original scope across the IPC seam", async t => {
  for (const state of ["replaced-before-next", "verified", "replaced", "foreign", "malformed", "missing"]) {
    const root = mkdtempSync(join(tmpdir(), "wave-parent-admission-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const plan = { schema: "oc-mem-wave-plan/1", cases: [{ id: "a", set: "tune", tier: "wide", conditions: ["direct"] }] }
    const wave = { id: "parent", model: WAVE_MODEL, control: join(root, "control"), store: join(root, "store"), cases_dir: root, docker_config: root, trial_timeout_s: 10, caps: { path: join(root, "caps.json") }, catalog: { path: "/fake" }, runtime: Object.fromEntries(["launcher_node", "docker", "node", "opencode"].map(k => [k, { path: "/fake" }])), arms: Object.fromEntries(["baseline", "candidate"].map(k => [k, { directory: "/fake", conditions: { path: "/fake" } }])), trials: completeTrials(plan) }
    writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [WAVE_MODEL]: { wide: 0.1 } } }))
    const child = new EventEmitter(), channel = new EventEmitter()
    child.pid = 23456; channel.connected = true
    let task, attempts = 0, live = true, now = 0, scope
    const requests = []
    channel.send = message => { requests.push(message); child.emit("message", message) }
    child.send = message => {
      if (message.type !== "start") { channel.emit("message", message); return }
      // JSON copy models a separate worker: it cannot access the parent's WeakMap entry.
      const workerWave = JSON.parse(JSON.stringify(wave))
      task = runTrials(workerWave, plan, { harness: "/fake", caller: { OPENCODE_API_KEY: "synthetic-key", MEM_WAVE_OWNER: JSON.stringify(scope.owner) }, lease: { elapsed: () => now }, verify: () => {
        if (state === "replaced-before-next" && attempts === 1) {
          const file = `${wave.trials[0].id}.json`, copied = readFileSync(join(scope.directory, file))
          renameSync(scope.directory, `${scope.directory}-original`); mkdirSync(scope.directory)
          writeFileSync(join(scope.directory, file), copied)
        }
      },
        verifyTrial: trial => requestTrialVerification(channel, trial.id),
        save: report => writeJSON(join(wave.control, "progress.json"), report),
        execute: async (_spec, trial) => {
          attempts++
          const raw = join(wave.store, "raw", `parent-${trial.id}`, "mem"), result = { case: "a", trial: 1, exit: 0 }
          mkdirSync(raw, { recursive: true })
          writeFileSync(join(raw, "a.t1.summary.json"), JSON.stringify({ ...result, model: WAVE_MODEL }))
          writeFileSync(join(raw, "batch-test.json"), JSON.stringify({ model: WAVE_MODEL, planned: 1, launched: 1, cases: ["a"], results: [result] }))
          const journal = { schema: "oc-evals-owned/1", batch: "b1234567890", owner: { ...scope.owner, trial_id: trial.id }, resources: [], pending: [], uncertain: false, verified_gone: true }
          if (state === "replaced" && attempts === 1) {
            writeFileSync(join(scope.directory, `${trial.id}.json`), JSON.stringify({ ...journal, pending: ["lost-create"], uncertain: true, verified_gone: false }))
            renameSync(scope.directory, `${scope.directory}-original`); mkdirSync(scope.directory)
          }
          if (state === "foreign") journal.owner.invocation_id = "foreign"
          if (state === "malformed") journal.resources = [null]
          writeFileSync(join(scope.directory, `${trial.id}.started.json`), "{}")
          if (state !== "missing") writeFileSync(join(scope.directory, `${trial.id}.json`), JSON.stringify(journal))
          recordRun(wave.store, { iteration: `parent-${trial.id}`, model: WAVE_MODEL, case: "a", trial: 1, billed_usd: 0.1, list_usd: 0.1, attempt_complete: true })
          return { code: 0, complete: true } // Synthetic cost isolates admission; not native terminal evidence.
        },
      }).then(report => { live = false; child.emit("exit", 0); return report })
    }
    const adapter = processAdapter({ spawn: () => child, groupIdentity: () => ({ probe: () => live ? "alive" : "gone", signal: () => assert.fail("worker finishes without a signal") }) })
    const report = await launchWave(wave, { manifestSha: "a".repeat(64), singleton: join(root, "singleton"), verify: () => {},
      clock: { wall: () => now, monotonic: () => now, sleep: async ms => { now += ms } },
      spawnWorker: (_lease, owned, verifyTrial) => { scope = owned; return adapter.worker({ command: "/fake", args: [], env: {}, ipc: true, verifyTrial }) },
      alive: adapter.alive, signal: adapter.signal, cleanup: (remaining, owned) => cleanupOwned(owned, () => assert.fail("no resource IDs in this fixture"), remaining),
    })
    await task
    assert.equal(attempts, state === "verified" ? 6 : 1, state)
    assert.equal(requests.length, state === "verified" ? 11 : state === "replaced-before-next" ? 2 : 1)
    assert.equal(report.supervision.cleanup_verified, state === "verified")
    assert.equal(existsSync(join(root, "singleton")), state !== "verified")
    assert.equal(report.trials.filter(t => t.status === "unrun").length, state === "verified" ? 0 : 5)
    assert.equal(channel.listenerCount("message"), 0)
    assert.equal(channel.listenerCount("disconnect"), 0)
    if (state === "replaced") assert.deepEqual(JSON.parse(readFileSync(join(`${scope.directory}-original`, `${wave.trials[0].id}.json`))).pending, ["lost-create"])
  }
})

test("copied owner fields and copied capabilities cannot verify even a well-formed receipt", t => {
  const root = mkdtempSync(join(tmpdir(), "wave-parent-owner-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const trial = { id: "a" }, wave = { control: root }
  const scope = createResourceScope(root, { manifestSha: "a".repeat(64), trials: [trial] })
  writeFileSync(join(scope.directory, "a.json"), JSON.stringify({ schema: "oc-evals-owned/1", batch: "b1234567890", owner: { ...scope.owner, trial_id: "a" }, resources: [], pending: [], uncertain: false, verified_gone: true }))
  for (const copied of [undefined, null, scope.owner, { ...scope }, JSON.parse(JSON.stringify(scope))]) assert.equal(trialCleanupVerified(wave, trial, copied), false)
  assert.equal(trialCleanupVerified(wave, trial, scope), true)
  renameSync(scope.directory, `${scope.directory}-original`); mkdirSync(scope.directory)
  writeFileSync(join(scope.directory, "a.json"), readFileSync(join(`${scope.directory}-original`, "a.json")))
  assert.equal(trialCleanupVerified(wave, trial, scope), false)
})

test("IPC reply errors, missing channels and mismatched receipts never admit a trial", async () => {
  for (const reply of [null, [], true, {}, { type: "trial-verification", trial_id: "other", verified: true }, { type: "trial-verification", trial_id: "a", verified: "true" }, { type: "trial-verification", trial_id: "a", verified: true }, "disconnect", "throws", "callback-error", "unconnected"]) {
    const channel = new EventEmitter()
    channel.connected = reply !== "unconnected"
    channel.send = (_message, callback) => {
      if (reply === "throws") throw new Error("send failed")
      if (reply === "callback-error") return callback(new Error("send failed"))
      if (reply === "disconnect") return channel.emit("disconnect")
      channel.emit("message", reply)
    }
    assert.equal(await requestTrialVerification(channel, "a"), reply?.verified === true && reply.trial_id === "a")
    assert.equal(channel.listenerCount("message"), 0)
    assert.equal(channel.listenerCount("disconnect"), 0)
  }
})
