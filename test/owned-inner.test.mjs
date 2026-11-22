import { test } from "node:test"
import assert from "node:assert/strict"
import { authorizeOwnedLaunch, ownedSession } from "../src/run/owned-launch.mjs"
import { ownedContainerBackend } from "../src/run/owned-backend.mjs"
import { createProvisionalSpool } from "../src/run/owned-spool.mjs"
import { setProcessGroupMode, setProcessRecorder, start } from "../src/run/sandbox.mjs"
import { EventEmitter } from "node:events"
import { runContainedEntry } from "../src/run/owned-entry.mjs"
import { runBatch } from "../src/run/runner.mjs"
const descriptor = () => ({ schema: "oc-owned-launch/1", binding: { invocation_id: "11111111-1111-4111-8111-111111111111", manifest_sha256: "a".repeat(64), trial_id: "trial-a" }, container_id: "1".repeat(64), context: "colima-mem-evals-20261122", inputs_sha256: "b".repeat(64), binaries_sha256: "c".repeat(64), options: { plugin: "mem", iteration: "trial-a", model: "opencode/deepseek-v4.1-flash#low", auth: "env:OPENCODE_API_KEY", cases: "core-a", casesDir: "/inputs/cases", set: "core", trials: 1, parallel: 1, arm: "/inputs/arm", world: "/inputs/harness/worlds/mem/index.mjs", host: "2.2.6", timeout: 60, stale: "refuse", tools: "locked", isolation: "owned-container", harnessRetries: 0, processGroup: "inherited" } })
const observation = { platform: "linux", mounts: "/ ro\n/inputs ro\n/opt/evals/bin ro\n/work rw", password: "synthetic-password" }

test("owned mode rejects ordinary host launch, absent/unbound descriptor and env-only container hints", () => {
  assert.throws(() => ownedSession({}), /parent/)
  assert.throws(() => authorizeOwnedLaunch(descriptor(), { ...observation, platform: "darwin" }), /Linux/)
  assert.throws(() => authorizeOwnedLaunch(descriptor(), { ...observation, mounts: "/.dockerenv" }), /mount/)
  const d = descriptor(); d.options.processGroup = "isolated"
  assert.throws(() => authorizeOwnedLaunch(d, observation), /single contained/)
})
test("ordinary runBatch owned-container flag refuses before any store, credential or world access", async () => {
  await assert.rejects(runBatch({ isolation: "owned-container" }, { caller: {}, log: () => assert.fail("no logging") }), /parent-bound/)
})
test("contained entry runs one bound job through the real runner seam and emits provisional bytes, not a final summary", async () => {
  const files = new Map(), sink = { open(name) { files.set(name, Buffer.alloc(0)); return { append: b => files.set(name, Buffer.concat([files.get(name), b])), close() {} } } }
  let calls = 0
  const receipt = await runContainedEntry(Buffer.from(JSON.stringify(descriptor())), { observation, sink, caller: {}, execute: async options => {
    calls++
    assert.equal(options.processGroup, "inherited")
    assert.equal(options.harnessRetries, 0)
    const session = ownedSession(options.ownedSession)
    session.recordExecution({ exit: 0 })
  } })
  assert.equal(calls, 1)
  assert.equal(receipt.exit, 0)
  assert.equal(receipt.complete, false)
  assert.deepEqual([...files.keys()], ["raw.jsonl", "provisional.json"])
})
test("inner leave means requested shutdown, never outer absence; local commands cannot use Docker or host paths", async () => {
  const capability = authorizeOwnedLaunch(descriptor(), observation)
  const backend = ownedContainerBackend(capability)
  const prev = setProcessGroupMode("inherited")
  try {
    const trial = await backend.enter({ sandbox: { root: "/work/batch/runs/core-a.t1" } })
    assert.equal(trial.wrap({ command: "/opt/evals/bin/node", args: ["fixture"], cwd: "/work/batch", env: {} }).command, "/opt/evals/bin/node")
    assert.throws(() => trial.wrap({ command: "docker", cwd: "/work", env: {} }), /local pinned/)
    await trial.leave(); await backend.teardown()
    assert.equal(await trial.gone(), false)
    assert.equal(await backend.allGone(), false)
  } finally { setProcessGroupMode(prev) }
})
test("inner continuously spools raw bytes and emits only a bounded provisional receipt", () => {
  const files = new Map(), opens = []
  const sink = { open(name) { opens.push(name); files.set(name, Buffer.alloc(0)); return { append: bytes => files.set(name, Buffer.concat([files.get(name), bytes])), close() {} } } }
  const d = descriptor(), spool = createProvisionalSpool(d, sink, { maxBytes: 1000 })
  const record = spool.start({ args: ["run"] })
  record("stdout", Buffer.from("first\n"))
  assert.equal(files.get("raw.jsonl").toString(), "first\n", "bytes survive even before execution settles")
  record("stdout", Buffer.from("last\n"))
  spool.finish({ exit: 0 })
  const receipt = JSON.parse(files.get("provisional.json"))
  assert.equal(receipt.complete, false)
  assert.equal(receipt.native, "unknown")
  assert.equal(receipt.cleanup, "parent-required")
  assert.equal(receipt.evidence.find(f => f.path === "raw.jsonl").bytes, 11)
  assert.throws(() => record("stdout", Buffer.from("late")), /sealed/)
})

export { descriptor, observation }

test("contained runner command spools each chunk, bounds memory and signals only its original child", async () => {
  const child = new EventEmitter(), chunks = [], signals = []
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 123; child.kill = signal => signals.push(signal)
  const prev = setProcessGroupMode("inherited")
  setProcessRecorder({ start: () => (channel, bytes) => chunks.push([channel, bytes.toString()]) }, { maxBytes: 4 })
  try {
    const proc = start("/opt/evals/bin/opencode", ["run"], {}, { spawn: () => child, kill: () => assert.fail("no PID/group authority") })
    child.stdout.emit("data", Buffer.from("abc"))
    assert.deepEqual(chunks, [["stdout", "abc"]])
    child.stdout.emit("data", Buffer.from("overflow"))
    assert.deepEqual(signals, ["SIGKILL"])
    child.emit("exit", null, "SIGKILL")
    assert.equal((await proc.exited).outputTruncated, true)
    assert.equal(proc.output().stdout, "abc")
  } finally { setProcessRecorder(null); setProcessGroupMode(prev) }
})
