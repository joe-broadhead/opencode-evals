import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { settleSingleAttempt } from "../src/run/runner.mjs"
import { waveCost } from "../src/run/wave-launcher.mjs"
import { readLedger } from "../src/cost/ledger.mjs"

const price = { input: 1, output: 2, cache_read: 1, cache_write: 1 }
const first = { type: "step_finish", part: { messageID: "msg_first", reason: "stop", cost: 11, tokens: { input: 1000, output: 100, cache: { read: 0, write: 0 } } } }
test("receipt lower bounds survive timeout/error/interruption and never certify the attempt total", t => {
  for (const outcome of [{ code: null, timedOut: true }, { code: 1, error: "failure" }, { code: null, signal: "SIGTERM" }, { code: 0 }]) {
    const store = mkdtempSync(join(tmpdir(), "wave-partial-cost-"))
    t.after(() => rmSync(store, { recursive: true, force: true }))
    const trial = { id: "first", case: "a", status: "incomplete" }, wave = { id: "cost", store }
    const stdout = [first, { type: "step_start", part: { messageID: "msg_second" } }].map(JSON.stringify).join("\n")
    settleSingleAttempt(store, { iteration: "cost-first", case: "a", trial: 1, model: "opencode/deepseek-v4.1-flash#low" }, { ...outcome, stdout }, price)
    const cost = waveCost(wave, [trial]), [row] = readLedger(store)
    assert.equal(cost.known_billed_usd, 11)
    assert.equal(cost.known_list_usd, 0.0012)
    assert.equal(cost.actual_billed_usd, null)
    assert.equal(cost.actual_list_usd, null)
    assert.deepEqual(cost.unresolved_trials, ["first"])
    assert.equal(cost.overshoot_is_lower_bound, true)
    assert.equal(row.billed_usd, null, "direct runner ledger must not certify a partial total")
    assert.equal(row.attempt_complete, false)
  }
})

test("full CLI receipts and exit zero are not the missing qualified native terminal proof", t => {
  const store = mkdtempSync(join(tmpdir(), "wave-terminal-cost-"))
  t.after(() => rmSync(store, { recursive: true, force: true }))
  const cost = settleSingleAttempt(store, {}, { code: 0, stdout: JSON.stringify(first) }, price)
  assert.equal(cost.known_billed_usd, 11)
  assert.equal(cost.receipt_usage_complete, true)
  assert.equal(cost.attempt_complete, false)
  assert.equal(cost.billed_usd, null)
  assert.equal(cost.list_usd, null)
  const invented = settleSingleAttempt(store, {}, { code: 0, terminal: true, stdout: [first, { type: "session.execution.succeeded", complete: true }].map(JSON.stringify).join("\n") }, price)
  assert.equal(invented.attempt_complete, false, "a fabricated CLI success marker cannot supply trusted native terminal evidence")
})

test("a missing token field is not priced as zero; other complete receipts remain visible", t => {
  const store = mkdtempSync(join(tmpdir(), "wave-receipt-cost-"))
  t.after(() => rmSync(store, { recursive: true, force: true }))
  const second = { type: "step_finish", part: { cost: 0.3, tokens: { input: 1000 } } }
  const cost = settleSingleAttempt(store, {}, { code: 0, stdout: [first, second].map(JSON.stringify).join("\n") }, price)
  assert.equal(cost.known_billed_usd, 11.3)
  assert.equal(cost.known_list_usd, 0.0012)
  assert.equal(cost.receipts[1].list_usd, null)
  assert.equal(cost.receipt_usage_complete, false)
})
