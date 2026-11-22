import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { claimWave, superviseGroup, cleanupOwned, trialCommand, runTrials, trialComplete, launchWave } from "../src/run/wave-launcher.mjs"
import { completeTrials } from "../src/run/wave-manifest.mjs"
import { recordRun } from "../src/cost/ledger.mjs"

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "wave-launcher-"))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  return root
}
function clock() {
  let mono = 0, wall = 10000000
  return { monotonic: () => mono, wall: () => wall, sleep: async ms => { mono += ms; wall += ms }, advance: ms => { mono += ms; wall += ms }, wallJump: ms => { wall += ms } }
}

test("one exclusive wave lock binds one store/manifest and never resets a completed round", t => {
  const root = fixture(t), time = clock(), input = { manifestSha: "a".repeat(64), store: join(root, "store") }
  const lease = claimWave(root, input, time)
  assert.throws(() => claimWave(root, input, time), /lock/)
  assert.throws(() => claimWave(root, { ...input, store: join(root, "other") }, time), /lock/)
  assert.equal(lease.deadline_wall, 13600000)
  lease.release(true)
  assert.equal(existsSync(join(root, "wave.lock")), false)
  assert.throws(() => claimWave(root, input, time), /already used/)
  assert.equal(JSON.parse(readFileSync(join(root, "wave.json"), "utf8")).store, input.store)
})

test("different control directories cannot bypass the context singleton", t => {
  const root = fixture(t), singleton = join(root, "context.lock"), time = clock()
  const input = { manifestSha: "a".repeat(64), store: join(root, "store"), singleton }
  const first = claimWave(join(root, "first"), input, time)
  assert.throws(() => claimWave(join(root, "second"), input, time), /lock/)
  first.release(true)
  const second = claimWave(join(root, "second"), input, time)
  second.release(true)
})

test("parent owns a fresh worker group, persists full interruption report and retains lock after failed cleanup", async t => {
  for (const clean of [true, false]) {
    const root = fixture(t), wave = fakeWave(root), time = clock()
    wave.trials = [{ id: "baseline-direct-a-r1", case: "a", arm: "baseline", condition: "direct", repetition: 1 }]
    let alive = true, spawned = 0
    const report = await launchWave(wave, { manifestSha: "a".repeat(64), clock: time, verify: async () => {}, spawnWorker: () => { spawned++; return { pgid: 12345, finished: () => false, exited: () => true } }, alive: () => alive, signal: () => { alive = false }, cleanup: async () => clean })
    assert.equal(spawned, 1)
    assert.equal(report.trials.length, 1)
    assert.equal(report.trials[0].status, "unrun")
    assert.equal(report.trials[0].reason, "worker-exited")
    assert.equal(report.supervision.cleanup_verified, clean)
    assert.equal(existsSync(join(root, "wave.lock")), !clean)
    assert.equal(JSON.parse(readFileSync(join(root, "worker.json"))).pgid, 12345)
  }
})

test("setup failure before worker start still invokes owned cleanup and retains an uncertain lock", async t => {
  const root = fixture(t), wave = fakeWave(root)
  wave.trials = [{ id: "baseline-direct-a-r1", case: "a" }]
  let cleaned = false
  const report = await launchWave(wave, { manifestSha: "a".repeat(64), clock: clock(), verify: async () => { throw new Error("setup interrupted") }, spawnWorker: () => assert.fail(), cleanup: async () => { cleaned = true; return false } })
  assert.equal(cleaned, true)
  assert.equal(report.supervision.cleanup_verified, false)
  assert.equal(existsSync(join(root, "wave.lock")), true)
})

test("CLI success is not trial completion without matching one-trial artifacts", t => {
  const root = fixture(t), wave = fakeWave(root), trial = { id: "baseline-direct-a-r1", case: "a" }
  assert.equal(trialComplete(wave, trial), false)
  const dir = join(wave.store, "raw", `unit-${trial.id}`, "mem")
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "a.t1.summary.json"), JSON.stringify({ case: "a", trial: 1, model: wave.model, exit: 0 }))
  writeFileSync(join(dir, "batch-test.json"), JSON.stringify({ planned: 2, launched: 1, cases: ["a"], results: [{}] }))
  assert.equal(trialComplete(wave, trial), false)
  writeFileSync(join(dir, "batch-test.json"), JSON.stringify({ model: wave.model, planned: 1, launched: 1, cases: ["a"], results: [{ case: "a", trial: 1, exit: 0 }] }))
  assert.equal(trialComplete(wave, trial), true)
  writeFileSync(join(dir, "a.t1.summary.json"), JSON.stringify({ case: "a", trial: 1, model: "fallback/model", exit: 0 }))
  assert.equal(trialComplete(wave, trial), false)
})

test("one trial at a time shares estimated admission across arms and preserves all unrun tuples after overshoot", async t => {
  const root = fixture(t), time = clock(), wave = fakeWave(root)
  const plan = { schema: "oc-mem-wave-plan/1", cases: [{ id: "a", set: "tune", conditions: ["direct", "search"], tier: "wide" }] }
  wave.trials = completeTrials(plan)
  writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [wave.model]: { wide: 1 } } }))
  const lease = claimWave(root, { manifestSha: "a".repeat(64), store: wave.store }, time)
  const saved = [], calls = []
  let active = 0, peak = 0
  const report = await runTrials(wave, plan, { harness: "/harness", caller: { OPENCODE_API_KEY: "fake-test-key" }, lease, verify: async () => {}, save: r => saved.push(JSON.stringify(r)), execute: async (spec, trial) => {
    active++; peak = Math.max(peak, active); calls.push(spec)
    await Promise.resolve()
    recordRun(wave.store, { model: wave.model, iteration: `unit-${trial.id}`, case: trial.case, trial: 1, list_usd: 11, billed_usd: 11 })
    active--
    return { code: 0, complete: true }
  } })
  assert.equal(peak, 1)
  assert.equal(calls.length, 1)
  assert.equal(report.trials.length, 12)
  assert.equal(report.trials.filter(t => t.status === "unrun" && t.reason === "budget-admission").length, 11)
  assert.equal(report.cost.known_list_usd, 11)
  assert.equal(report.cost.overshoot_usd, 1)
  assert.equal(report.target_not_maximum, true)
  assert.equal(saved.join("").includes("fake-test-key"), false)
})

function fakeWave(root) {
  return { id: "unit", model: "opencode/deepseek-v4.1-flash#low", control: root, store: join(root, "store"), cases_dir: join(root, "cases"), docker_config: join(root, "docker-config"), trial_timeout_s: 420,
    runtime: { version: "2.2.6", opencode: { path: "/qualified/opencode" }, node: { path: "/qualified/node-linux" }, docker: { path: "/qualified/docker" }, launcher_node: { path: "/qualified/node-host" }, image: `sha256:${"d".repeat(64)}` },
    caps: { path: join(root, "caps.json") }, catalog: { path: join(root, "catalog.json") },
    arms: { baseline: { directory: "/qualified/baseline", conditions: { path: "/qualified/base-conditions.json" } }, candidate: { directory: "/qualified/candidate", conditions: { path: "/qualified/candidate-conditions.json" } } } }
}

test("trial CLI forces one trial, zero retries, inherited group, one store/target, and env-only key", t => {
  const root = fixture(t), wave = fakeWave(root), trial = { id: "baseline-direct-a-r1", case: "a", arm: "baseline", condition: "direct", repetition: 1 }
  const spec = trialCommand(wave, trial, { id: "a", set: "tune" }, "/harness", 12500, { PATH: "/bin", OPENCODE_API_KEY: "synthetic-test-key", EVALS_STORE: "/wrong", DOCKER_CONTEXT: "default" })
  assert.equal(spec.env.EVALS_STORE, wave.store)
  assert.equal(spec.env.EVALS_ROUND_CAP_USD, "10")
  assert.equal(spec.env.DOCKER_CONTEXT, "colima-mem-evals-20261122")
  assert.equal(spec.env.EVALS_CONTAINER_SWEEP_SCOPE, "own")
  assert.equal(spec.args[spec.args.indexOf("--timeout") + 1], "12")
  for (const [flag, value] of [["--trials", "1"], ["--parallel", "1"], ["--harness-retries", "0"], ["--process-group", "inherited"], ["--auth", "env:OPENCODE_API_KEY"]]) assert.equal(spec.args[spec.args.indexOf(flag) + 1], value)
  assert.equal(JSON.stringify(spec.args).includes("synthetic-test-key"), false)
  assert.throws(() => trialCommand(wave, trial, { set: "tune" }, "/harness", 12500, {}), /OPENCODE_API_KEY/)
})

test("emergency Docker cleanup uses only creation IDs and explicit context; unresolved creation blocks clean status", async t => {
  const root = fixture(t), ids = ["1".repeat(64), "2".repeat(64)], calls = []
  mkdirSync(join(root, "resources"))
  const file = join(root, "resources", "trial-a.json")
  const receipt = { schema: "oc-evals-owned/1", batch: "b1234567890", resources: [{ kind: "network", id: ids[1] }, { kind: "container", id: ids[0] }], pending: [], uncertain: false }
  writeFileSync(file, JSON.stringify(receipt))
  const exec = async (args, timeout) => {
    calls.push(args)
    assert.ok(timeout <= 20000)
    return args.includes("inspect") ? { code: 1, stderr: "No such object", stdout: "" } : { code: 0, stdout: "", stderr: "" }
  }
  const wave = { trials: [{ id: "trial-a" }] }
  assert.equal(await cleanupOwned(wave, root, exec, () => 20000), true)
  assert.deepEqual(calls[0], ["--context", "colima-mem-evals-20261122", "rm", "-f", "-v", ids[0]])
  assert.equal(calls.every(args => ids.includes(args.at(-1)) && !args.includes("ps")), true)
  receipt.pending = ["unknown-response"]
  writeFileSync(file, JSON.stringify(receipt))
  assert.equal(await cleanupOwned(wave, root, exec, () => 20000), false)
  assert.equal(await cleanupOwned(wave, root, async () => ({ code: 1, stderr: "daemon unavailable" }), () => 20000), false)
  receipt.pending = []
  writeFileSync(file, JSON.stringify(receipt))
  assert.equal(await cleanupOwned(wave, root, async () => ({ code: null, stderr: "No such object before interrupted client" }), () => 20000), false)
})

test("independent watchdog includes setup time, escalates the exact hung group, and reserves cleanup time", async t => {
  const root = fixture(t), time = clock(), lease = claimWave(root, { manifestSha: "a".repeat(64), store: join(root, "store") }, time)
  time.advance(3400000)
  let alive = true, cleanupAt = null
  const signals = []
  const result = await superviseGroup(lease, { child: { pgid: 12345, finished: () => false, exited: () => false }, alive: () => alive, signal: (pgid, sig) => { signals.push([pgid, sig]); if (sig === "SIGKILL") alive = false }, cleanup: async () => { cleanupAt = lease.elapsed(); time.advance(500); return true } }, time)
  assert.equal(result.reason, "local-timeout")
  assert.deepEqual(signals, [[12345, "SIGTERM"], [12345, "SIGKILL"]])
  assert.equal(cleanupAt, 3490000)
  assert.equal(result.cleanup_verified, true)
  assert.equal(result.remote_cancellation_guaranteed, false)
})

test("reparented children stay owned by the group; failed exit or teardown is never called clean", async t => {
  for (const fails of ["exit", "cleanup"]) {
    const root = join(fixture(t), fails), time = clock(), lease = claimWave(root, { manifestSha: "a".repeat(64), store: join(root, "store") }, time)
    let alive = true
    const result = await superviseGroup(lease, { child: { pgid: 23456, finished: () => false, exited: () => true }, alive: () => alive, signal: (pid, sig) => { assert.equal(pid, 23456); if (fails !== "exit" && sig === "SIGKILL") alive = false }, cleanup: async () => false }, time)
    assert.equal(result.cleanup_verified, false)
    assert.equal(result.reason, "worker-exited")
    assert.ok(lease.elapsed() <= 3600000)
  }
})

test("wall-clock suspension past the deadline still kills a hung owned group and reports lateness", async t => {
  const root = fixture(t), time = clock(), lease = claimWave(root, { manifestSha: "a".repeat(64), store: join(root, "store") }, time)
  time.wallJump(4000000)
  let live = true
  const signals = []
  const result = await superviseGroup(lease, { child: { pgid: 12345, finished: () => false, exited: () => false }, alive: () => live, signal: (_, s) => { signals.push(s); if (s === "SIGKILL") live = false }, cleanup: async () => assert.fail("deadline exhausted") }, time)
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"])
  assert.equal(result.deadline_exceeded, true)
  assert.equal(result.cleanup_verified, false)
})

test("clock reversal cannot give the wave back elapsed time", t => {
  const root = fixture(t), time = clock(), lease = claimWave(root, { manifestSha: "a".repeat(64), store: join(root, "store") }, time)
  time.advance(1000); time.wallJump(20000)
  assert.equal(lease.elapsed(), 21000)
  time.wallJump(-20000)
  assert.equal(lease.elapsed(), 21000)
})

test("missing usage stops after the first attempt with actual cost unknown and every unrun tuple retained", async t => {
  const root = fixture(t), wave = fakeWave(root), time = clock()
  const plan = { schema: "oc-mem-wave-plan/1", cases: [{ id: "a", set: "tune", tier: "wide", conditions: ["direct", "search"] }] }
  wave.trials = completeTrials(plan)
  writeFileSync(wave.caps.path, JSON.stringify({ estimate_run_usd: { [wave.model]: { wide: 1 } } }))
  const lease = claimWave(root, { manifestSha: "a".repeat(64), store: wave.store }, time)
  let attempts = 0
  const result = await runTrials(wave, plan, { harness: "/harness", caller: { OPENCODE_API_KEY: "fake-key" }, lease, verify: async () => {}, save: () => {}, execute: async (_, trial) => {
    attempts++
    recordRun(wave.store, { iteration: `unit-${trial.id}`, model: wave.model, case: "a", trial: 1, billed_usd: 0.27, list_usd: null, usage_missing: true })
    return { code: 0, complete: true }
  } })
  assert.equal(attempts, 1)
  assert.equal(result.cost.known_billed_usd, 0.27)
  assert.equal(result.cost.actual_billed_usd, null)
  assert.equal(result.trials.filter(t => t.status === "unrun").length, 11)
  assert.equal(result.trials[0].status, "incomplete")
})

test("signal requests cause exact owned-group teardown without waiting for the work deadline", async t => {
  const root = fixture(t), time = clock(), lease = claimWave(root, { manifestSha: "a".repeat(64), store: join(root, "store") }, time)
  let alive = true
  const result = await superviseGroup(lease, { child: { pgid: 12345, finished: () => false, exited: () => false }, alive: () => alive, signal: (pid, signal) => { assert.equal(pid, 12345); assert.equal(signal, "SIGTERM"); alive = false }, cleanup: async () => true, stopRequested: () => "SIGINT" }, time)
  assert.equal(result.reason, "signal")
  assert.equal(result.cleanup_verified, true)
  assert.equal(result.elapsed_ms, 0)
})
