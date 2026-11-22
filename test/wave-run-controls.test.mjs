import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { harnessRetryLimit, rateLimitOutcome, settleSingleAttempt, runBatch } from "../src/run/runner.mjs"
import { readLedger } from "../src/cost/ledger.mjs"
import { EventEmitter } from "node:events"
import { setProcessGroupMode, start, killAll, sealedConfig } from "../src/run/sandbox.mjs"

test("explicit retry limit is bounded; zero forbids the first retry without changing legacy defaults", () => {
  assert.equal(harnessRetryLimit(undefined), undefined)
  assert.equal(harnessRetryLimit("0"), 0)
  assert.equal(harnessRetryLimit("3"), 3)
  for (const value of ["", true, -1, 4, 0.5, "NaN", "1x"]) assert.throws(() => harnessRetryLimit(value), /retry/)
  assert.equal(rateLimitOutcome(0, true).retry, true)
  assert.deepEqual(rateLimitOutcome(0, true, 0), { retry: false, infra: "rate-limit" })
})

test("run refuses unqualified or invalid conditions before setup", async () => {
  await assert.rejects(runBatch({ condition: "direct" }, { caller: {}, log: () => {} }), /qualification/)
  await assert.rejects(runBatch({ condition: "invented" }, { caller: {}, log: () => {} }), /condition/)
  await assert.rejects(runBatch({ conditionQualification: "unused" }, { caller: {}, log: () => {} }), /condition/)
})

test("a later legacy invocation does not inherit a previous supervised process mode", async () => {
  setProcessGroupMode("inherited")
  await assert.rejects(runBatch({ condition: "invalid" }, { caller: {}, log: () => {} }), /condition/)
  assert.equal(setProcessGroupMode(), "isolated")
})

test("direct/search have distinct documented execute permission settings without changing legacy config", () => {
  const base = { armDir: null, model: "opencode/deepseek-v4.1-flash#low" }
  assert.equal(sealedConfig(base).permissions, undefined)
  assert.deepEqual(sealedConfig({ ...base, condition: "direct" }).permissions, [{ action: "execute", resource: "*", effect: "deny" }])
  assert.deepEqual(sealedConfig({ ...base, condition: "search" }).permissions, [{ action: "execute", resource: "*", effect: "allow" }])
  assert.throws(() => sealedConfig({ ...base, condition: "unknown" }), /condition/)
})

test("supervised children inherit the wave group and runner cleanup never signals that group", async (t) => {
  const calls = [], signals = []
  const previous = setProcessGroupMode("inherited")
  t.after(() => setProcessGroupMode(previous))
  assert.throws(() => setProcessGroupMode("guess"), /process-group/)
  const child = new EventEmitter()
  child.pid = 90123
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
  child.kill = signal => { signals.push(signal); if (signal !== 0) child.emit("exit", null, signal); return true }
  const proc = start("fake", [], {}, { spawn: (...args) => { calls.push(args); return child }, kill: () => assert.fail("must not signal a shared group") })
  assert.equal(calls[0][2].detached, false)
  await killAll({ graceMs: 0 })
  await proc.exited
  assert.deepEqual(signals, ["SIGTERM"])
  proc.kill("SIGKILL")
  assert.deepEqual(signals, ["SIGTERM"], "do not signal an exited/reused PID")
})

test("single-attempt accounting retains billed cost with absent tokens and unresolved rate-limit usage", (t) => {
  const store = mkdtempSync(join(tmpdir(), "wave-cost-"))
  t.after(() => rmSync(store, { recursive: true, force: true }))
  const identity = { batch: "b1", month: "2026-11", iteration: "wave", plugin: "mem", model: "opencode/deepseek-v4.1-flash#low", trial: 1 }
  settleSingleAttempt(store, { ...identity, case: "priced" }, { stdout: JSON.stringify({ type: "step_finish", part: { cost: 0.27 } }), stderr: "429 rate limit" }, { input: 1, output: 2, cache_read: 1, cache_write: 1 })
  settleSingleAttempt(store, { ...identity, case: "unknown" }, { stdout: "", stderr: "429 rate limit" }, null)
  const rows = readLedger(store)
  assert.equal(rows.length, 2)
  assert.equal(rows[0].billed_usd, 0.27)
  assert.equal(rows[0].list_usd, null)
  assert.equal(rows[0].usage_missing, true)
  assert.equal(rows[1].billed_usd, null)
  assert.equal(rows[1].list_usd, null)
  assert.equal(rows[1].usage_missing, true)
})
