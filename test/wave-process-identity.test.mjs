import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { processAdapter } from "../src/run/wave-process.mjs"

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
