import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createOwnedDockerClient } from "../src/run/owned-docker-client.mjs"

function setup() {
  let at = 0, next = 0
  const timers = new Map(), children = [], calls = []
  const clock = { now: () => at, set: (fn, ms) => { const id = ++next; timers.set(id, { fn, at: at + ms }); return id }, clear: id => timers.delete(id), tick() { const [id, t] = [...timers].sort((a,b) => a[1].at-b[1].at)[0]; timers.delete(id); at = t.at; t.fn() } }
  const spawn = (bin, args, options) => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = { on() {}, end() {} }
    child.signals = []; child.kill = signal => child.signals.push(signal)
    children.push(child); calls.push({ bin, args, options }); return child
  }
  const client = createOwnedDockerClient({ binary: "/pinned/docker", context: "colima-mem-evals-20261122", config: "/parent/docker", credentialValues: { OPENCODE_API_KEY: "synthetic-private-value" } }, { spawn, clock })
  return { client, children, calls, clock }
}
const args = ["--context", "colima-mem-evals-20261122", "exec", "-e", "OPENCODE_API_KEY", "1".repeat(64), "node"]

test("direct Docker client requires exit AND close and never puts credential values in argv or returned output", async () => {
  const f = setup(), promise = f.client.run(args, { credentialNames: ["OPENCODE_API_KEY"], timeoutMs: 100, maxBytes: 1000 })
  const c = f.children[0]
  c.stdout.emit("data", Buffer.from("synthetic-private-value")); c.emit("exit", 0, null)
  assert.equal(f.client.closed(), false)
  c.emit("close", 0, null)
  const result = await promise
  assert.equal(result.closed, true)
  assert.equal(result.stdout.includes("synthetic-private-value"), false)
  assert.equal(f.calls[0].options.env.OPENCODE_API_KEY, "synthetic-private-value")
  assert.equal(JSON.stringify(f.calls[0].args).includes("synthetic-private-value"), false)
  assert.equal(f.calls[0].options.shell, false)
  assert.equal(f.calls[0].options.detached, false)
  assert.equal(f.client.closed(), true)
})

test("timeout/output overflow signal only original live handle and unknown closure remains tracked", async () => {
  for (const overflow of [false, true]) {
    const f = setup(), promise = f.client.run(args, { timeoutMs: 100, maxBytes: 4 })
    const c = f.children[0]
    if (overflow) c.stdout.emit("data", Buffer.from("too many bytes")); else f.clock.tick()
    f.clock.tick()
    const result = await promise
    assert.equal(result.closed, false)
    assert.equal(f.client.closed(), false)
    assert.deepEqual(c.signals, ["SIGTERM", "SIGKILL"])
    c.emit("exit", null, "SIGKILL"); c.emit("close", null, "SIGKILL")
    assert.equal(f.client.closed(), true)
    assert.equal(await f.client.stopClients(), true)
    assert.deepEqual(c.signals, ["SIGTERM", "SIGKILL"])
  }
})
