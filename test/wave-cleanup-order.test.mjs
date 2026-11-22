import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { completeTrials, WAVE_MODEL } from "../src/run/wave-manifest.mjs"
import { createResourceScope, runTrials, trialComplete } from "../src/run/wave-launcher.mjs"
import { recordRun } from "../src/cost/ledger.mjs"

test("next-trial admission requires bound verified cleanup, independently of successful billing and CLI results", async t => {
  for (const state of ["containers-left", "missing", "pending", "uncertain", "foreign", "unverified", "verified"]) {
    const root = mkdtempSync(join(tmpdir(), "wave-cleanup-order-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const plan = { schema: "oc-mem-wave-plan/1", cases: [{ id: "a", set: "tune", tier: "wide", conditions: ["direct"] }] }
    const wave = { id: "order", model: WAVE_MODEL, control: root, store: join(root, "store"), cases_dir: root, docker_config: root, trial_timeout_s: 10, caps: { path: join(root, "caps.json") }, catalog: { path: "/fake" }, runtime: Object.fromEntries(["launcher_node", "docker", "node", "opencode"].map(k => [k, { path: "/fake" }])), arms: Object.fromEntries(["baseline", "candidate"].map(k => [k, { directory: "/fake", conditions: { path: "/fake" } }])), trials: completeTrials(plan) }
    const scope = createResourceScope(root, { manifestSha: "a".repeat(64), trials: wave.trials })
    writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [WAVE_MODEL]: { wide: 0.1 } } }))
    let attempts = 0
    const observedCompletion = []
    const report = await runTrials(wave, plan, { harness: "/fake", caller: { OPENCODE_API_KEY: "test-key", MEM_WAVE_OWNER: JSON.stringify(scope.owner) }, lease: { elapsed: () => 0 }, verify: async () => {}, save: () => {}, execute: async (_, trial) => {
      attempts++
      const raw = join(wave.store, "raw", `order-${trial.id}`, "mem")
      mkdirSync(raw, { recursive: true })
      const result = { case: "a", trial: 1, exit: 0 }
      writeFileSync(join(raw, "a.t1.summary.json"), JSON.stringify({ ...result, model: WAVE_MODEL }))
      writeFileSync(join(raw, "batch-test.json"), JSON.stringify({ model: WAVE_MODEL, planned: 1, launched: 1, cases: ["a"], results: [result], containers_left: state === "containers-left" }))
      if (state !== "missing") writeFileSync(join(scope.directory, `${trial.id}.json`), JSON.stringify({ schema: "oc-evals-owned/1", batch: "b1234567890", owner: { ...scope.owner, trial_id: state === "foreign" ? "other" : trial.id }, resources: [{ kind: "container", id: "a".repeat(64) }], pending: state === "pending" ? ["lost-create"] : [], uncertain: state === "uncertain", verified_gone: state !== "unverified" }))
      // Synthetic certified-cost row isolates cleanup admission from the separate unavailable terminal producer.
      recordRun(wave.store, { iteration: `order-${trial.id}`, model: WAVE_MODEL, case: "a", trial: 1, billed_usd: 0.1, list_usd: 0.1, attempt_complete: true })
      observedCompletion.push(trialComplete(wave, trial, scope))
      return { code: 0, complete: true } // This assertion alone must never admit another trial.
    } })
    assert.equal(attempts, state === "verified" ? 6 : 1, state)
    if (state === "containers-left") assert.deepEqual(observedCompletion, [false])
    assert.equal(report.trials.filter(t => t.status === "unrun").length, state === "verified" ? 0 : 5, state)
  }
})
