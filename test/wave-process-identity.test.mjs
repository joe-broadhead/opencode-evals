import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { processAdapter } from "../src/run/wave-process.mjs"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { launchWave } from "../src/run/wave-launcher.mjs"

test("only a validated per-instance handle releases start IPC through the launcher", async t => {
  const shapes = [undefined, null, false, 1, "handle", [], {}, { probe: () => "alive" }, { signal: () => true }, { probe: 1, signal: () => true }, { probe: () => "alive", signal: false }, "throws", "valid"]
  for (const shape of shapes) {
    const root = mkdtempSync(join(tmpdir(), "wave-activation-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const child = new EventEmitter(), messages = [], signals = []
    child.pid = 23456
    child.send = message => { messages.push(message); child.emit("exit", 0) }
    let now = 0, live = true
    const adapter = processAdapter({ spawn: () => child, kill: () => assert.fail("numeric fallback"), groupIdentity: () => {
      if (shape === "throws") throw new Error("acquisition failed")
      return shape === "valid" ? { probe: () => live ? "alive" : "gone", signal: s => { signals.push(s); live = false; return true } } : shape
    } })
    const wave = { id: "identity", control: join(root, "control"), store: join(root, "store"), docker_config: root, trials: [{ id: "a", case: "a" }] }
    const report = await launchWave(wave, { manifestSha: "a".repeat(64), singleton: join(root, "singleton"), verify: () => {},
      clock: { wall: () => now, monotonic: () => now, sleep: async ms => { now += ms } },
      spawnWorker: () => adapter.worker({ command: "/fake", args: [], env: {}, ipc: true }), alive: adapter.alive, signal: adapter.signal,
      cleanup: () => { assert.equal(shape, "valid"); return true },
    })
    assert.deepEqual(messages, shape === "valid" ? [{ type: "start" }] : [])
    assert.equal(report.supervision.cleanup_verified, shape === "valid")
    assert.equal(report.supervision.group_gone, shape === "valid")
    assert.equal(existsSync(join(root, "singleton")), shape !== "valid")
    assert.equal(JSON.parse(readFileSync(join(wave.control, "worker.json"))).pgid, 23456)
    if (shape !== "valid") {
      assert.equal(report.stop_reason, "supervision-unavailable")
      assert.deepEqual(signals, [])
      child.emit("exit", 0)
      assert.equal(adapter.alive(23456), true, "leader exit does not prove unknown descendants gone")
    }
  }
})

test("numeric PGID and kill-zero cannot establish authority, before or after leader exit", () => {
  const child = new EventEmitter(); child.pid = 23456
  const delivered = []
  const adapter = processAdapter({ spawn: () => child, kill: (...args) => delivered.push(args) })
  const worker = adapter.worker({ command: "/fake", args: [], env: {} })
  assert.equal(adapter.supervisionAvailable, false)
  adapter.signal(worker.pgid, "SIGTERM")
  child.emit("exit", 0)
  assert.equal(adapter.alive(worker.pgid), true, "unknown descendants are not proof of absence")
  adapter.signal(worker.pgid, "SIGKILL")
  assert.deepEqual(delivered, [], "no numeric signal or liveness probe is authorized")
})

test("identity acquisition failure cannot hide an already-spawned worker from supervision", () => {
  const child = new EventEmitter(); child.pid = 23456
  const adapter = processAdapter({ spawn: () => child, groupIdentity: () => { throw new Error("identity unavailable") } })
  const worker = adapter.worker({ command: "/fake", args: [], env: {} })
  assert.equal(worker.pgid, 23456)
  assert.equal(adapter.alive(worker.pgid), true)
  assert.equal(adapter.signal(worker.pgid, "SIGKILL"), false)
  assert.throws(() => worker.activate(), /incarnation/)
})

test("launcher requires affirmative per-worker readiness before calling activation", async t => {
  for (const ready of [undefined, null, 0, "true", false]) {
    const root = mkdtempSync(join(tmpdir(), "wave-readiness-"))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    let activations = 0, now = 0
    const report = await launchWave({ id: "ready", control: root, store: join(root, "store"), docker_config: root, trials: [{ id: "a" }] }, {
      manifestSha: "a".repeat(64), verify: () => {},
      clock: { wall: () => now, monotonic: () => now, sleep: async ms => { now += ms } },
      spawnWorker: () => ({ pgid: 23456, supervisionReady: ready, exited: () => true, finished: () => false, activate: () => { activations++ } }),
      alive: () => true, signal: () => false, cleanup: () => assert.fail("unresolved child"),
    })
    assert.equal(activations, 0)
    assert.equal(report.stop_reason, "supervision-unavailable")
    assert.equal(report.supervision.cleanup_verified, false)
  }
})

test("an injected identity-bound handle preserves reparented descendants without signaling reused groups", () => {
  for (const reuseAt of ["first-probe", "escalation", "never"]) {
    const child = new EventEmitter(); child.pid = 23456
    let original = true, descendants = true
    const delivered = []
    const adapter = processAdapter({ spawn: () => child, kill: () => assert.fail("no numeric fallback"), groupIdentity: () => ({
      probe: () => original && descendants ? "alive" : "gone",
      signal: signal => {
        if (!original) return false // Simulated atomic incarnation-bound operation, not a ps/check/kill implementation.
        delivered.push(signal)
        if (signal === "SIGKILL") descendants = false
        return true
      },
    }) })
    const worker = adapter.worker({ command: "/fake", args: [], env: {} })
    child.emit("exit", 0) // The fake owned descendant remains after leader exit.
    if (reuseAt === "first-probe") original = false
    if (adapter.alive(worker.pgid)) adapter.signal(worker.pgid, "SIGTERM")
    if (reuseAt === "escalation") original = false
    adapter.signal(worker.pgid, "SIGKILL")
    assert.deepEqual(delivered, reuseAt === "never" ? ["SIGTERM", "SIGKILL"] : reuseAt === "escalation" ? ["SIGTERM"] : [])
    assert.equal(adapter.alive(worker.pgid), false)
  }
})
