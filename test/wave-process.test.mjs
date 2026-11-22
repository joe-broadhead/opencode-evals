import { test } from "node:test"
import assert from "node:assert/strict"
import { EventEmitter } from "node:events"
import { processAdapter } from "../src/run/wave-process.mjs"

test("process adapter owns only its newly detached worker group and never logs the key", async () => {
  const calls = [], signals = [], child = new EventEmitter()
  child.pid = 45678
  const adapter = processAdapter({ spawn: (...args) => { calls.push(args); return child }, kill: (...args) => signals.push(args) })
  const spec = { command: "/node", args: ["worker"], env: { OPENCODE_API_KEY: "fake-key" } }
  const owned = adapter.worker(spec)
  assert.equal(calls[0][2].detached, true)
  assert.deepEqual(calls[0][2].stdio, ["ignore", "ignore", "ignore"])
  assert.equal(JSON.stringify(calls[0][1]).includes("fake-key"), false)
  assert.throws(() => adapter.signal(11111, "SIGTERM"), /owned/)
  adapter.signal(owned.pgid, "SIGTERM")
  assert.deepEqual(signals, [[-45678, "SIGTERM"]])
  child.emit("exit", 0, null)
  assert.equal(owned.finished(), true)
  assert.equal(owned.exited(), true)
})

test("trial child inherits the group and spawn failure resolves incomplete without emitting errors", async () => {
  const child = new EventEmitter(), calls = []
  child.pid = 56789
  const adapter = processAdapter({ spawn: (...args) => { calls.push(args); return child } })
  const result = adapter.trial({ command: "/node", args: [], env: {} })
  child.emit("error", new Error("sensitive error"))
  assert.deepEqual(await result, { code: null })
  assert.equal(calls[0][2].detached, false)
})

test("cleanup client is killed by exact handle and cannot report success without verified exit", async () => {
  const child = new EventEmitter(), timers = [], signals = []
  child.pid = 67890; child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
  child.kill = signal => { signals.push(signal); return true }
  const adapter = processAdapter({ spawn: () => child, setTimer: callback => { timers.push(callback); return callback }, clearTimer: () => {} })
  const promise = adapter.command({ command: "/docker", args: ["--context", "test", "inspect", "owned-id"], env: {} }, 100)
  timers[0]()
  assert.deepEqual(signals, ["SIGKILL"])
  timers[1]()
  assert.equal((await promise).code, null)
  assert.deepEqual(adapter.unverified(), [67890])
  child.emit("error", new Error("kill permission error is not an exit"))
  assert.deepEqual(adapter.unverified(), [67890])
  child.emit("exit", null, "SIGKILL")
  assert.deepEqual(adapter.unverified(), [])
})
