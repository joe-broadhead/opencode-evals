// Actual entry/recorder/spool/finalizer composition; children and clocks are injected, never spawned.
import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { runContainedEntry } from "../src/run/owned-entry.mjs"
import { ownedSession } from "../src/run/owned-launch.mjs"
import { start } from "../src/run/sandbox.mjs"
import { finalizeOwnedTrial } from "../src/run/owned-postmortem.mjs"

const binding = { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "a".repeat(64), trial_id: "trial-a" }
const descriptor = { schema: "oc-owned-launch/1", binding, container_id: "1".repeat(64), context: "colima-mem-evals-20261122", inputs_sha256: "b".repeat(64), binaries_sha256: "c".repeat(64), options: { plugin: "mem", iteration: "trial-a", model: "opencode/deepseek-v4.1-flash#low", auth: "env:OPENCODE_API_KEY", cases: "core-a", casesDir: "/inputs/cases", set: "core", trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: 60, stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited" } }
const step = cost => Buffer.from(JSON.stringify({ type: "step_finish", part: { cost } }) + "\n")
const flush = async () => { for (let n = 0; n < 200; n++) await Promise.resolve() }
function setup(count = 1) {
  let now = 0, next = 0
  const timers = new Map(), files = new Map(), children = []
  const clock = { now: () => now, set(fn, ms) { const id = ++next; timers.set(id, { at: now + ms, fn }); return id }, clear: id => timers.delete(id), tick() { const [id, timer] = [...timers][0]; now = timer.at; timers.delete(id); timer.fn() } }
  const sink = { open(name) { files.set(name, Buffer.alloc(0)); return { append: bytes => files.set(name, Buffer.concat([files.get(name), bytes])), close() {} } } }
  const entry = runContainedEntry(Buffer.from(JSON.stringify(descriptor)), { sink, clock, drainMs: 25, caller: {}, observation: { platform: "linux", mounts: "/ ro\n/inputs ro\n/opt/evals/bin ro\n/work rw", password: "synthetic-password" }, execute: async options => {
    const exited = []
    for (let i = 0; i < count; i++) {
      const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => assert.fail("no signal needed for drain")
      children.push(child)
      const proc = start("/opt/evals/bin/opencode", [i ? "serve" : "run"], {}, { spawn: () => child, kill: () => assert.fail("no PID authority") })
      if (i === 0) child.stdout.emit("data", step(0.03))
      child.emit("exit", 0, null); exited.push(proc.exited)
    }
    await Promise.all(exited)
    ownedSession(options.ownedSession).recordExecution({ exit: 0 })
  } })
  const finalize = () => finalizeOwnedTrial({ binding, config: { ...binding, id: descriptor.container_id, verified: true, launch_sha256: createHash("sha256").update(JSON.stringify(descriptor)).digest("hex"), case_id: "core-a" }, cleanup_verified: true, host_clients_closed: true, worker_exit: 1 }, { read: async name => files.get(name) })
  return { entry, files, children, clock, timers, finalize }
}

test("entry drains original CLI pipes after exit before sealing both billed steps", async () => {
  const f = setup(); await flush()
  assert.equal(f.files.has("provisional.json"), false)
  f.children[0].stdout.emit("data", step(0.07))
  f.children[0].emit("close", 0, null)
  const receipt = await f.entry, result = await f.finalize()
  assert.equal(receipt.overflow, false)
  assert.equal(receipt.streams_closed, true)
  assert.deepEqual(f.files.get("raw.jsonl"), Buffer.concat([step(0.03), step(0.07)]))
  assert.equal(result.evidence, "verified")
  assert.equal(result.accounting.known_billed_usd, 0.1)
  assert.equal(result.accounting.receipts.length, 2)
  assert.equal(result.accounting.complete, false)
  assert.equal(f.timers.size, 0)
})

test("drain waits for every recorder-associated child, retaining stdout and stderr tails", async () => {
  const f = setup(2); await flush()
  f.children[0].stdout.emit("data", step(0.07)); f.children[0].stderr.emit("data", Buffer.from("CLI tail")); f.children[0].emit("close", 0, null)
  await flush(); assert.equal(f.files.has("provisional.json"), false)
  f.children[1].stdout.emit("data", Buffer.from("server tail")); f.children[1].stderr.emit("data", Buffer.from("server diagnostic")); f.children[1].emit("close", 0, null)
  await f.entry
  const result = await f.finalize()
  assert.equal(result.evidence, "verified")
  assert.equal(result.accounting.known_billed_usd, 0.1)
  assert.equal(f.files.get("process-1.stderr").toString(), "CLI tail")
  assert.equal(f.files.get("process-2.stdout").toString(), "server tail")
  assert.equal(f.files.get("process-2.stderr").toString(), "server diagnostic")
  assert.equal(f.timers.size, 0)
})

test("missing close has a finite drain bound and preserves only an explicitly incomplete billed prefix", async () => {
  const f = setup(); await flush()
  assert.equal(f.files.has("provisional.json"), false)
  f.clock.tick()
  const receipt = await f.entry
  assert.equal(f.clock.now(), 25)
  assert.equal(receipt.overflow, true)
  assert.equal(receipt.streams_closed, false)
  const before = Buffer.from(f.files.get("provisional.json"))
  f.children[0].stdout.emit("data", step(0.07)); f.children[0].emit("close", 0, null)
  assert.deepEqual(f.files.get("provisional.json"), before, "late events cannot upgrade a sealed incomplete receipt")
  const result = await f.finalize()
  assert.equal(result.evidence, "unknown")
  assert.equal(result.accounting.known_billed_usd, 0.03)
  assert.equal(result.accounting.complete, false)
  assert.equal(result.accounting.billed_usd, null)
  assert.equal(f.timers.size, 0)
})
