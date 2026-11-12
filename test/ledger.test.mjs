// The run caps hold before any run starts, across invocations, and whatever a run costs.
import { test } from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { loadCaps, reserve, release, recordRun, readLedger, usage, checkCaps, CapError, withLock, DEFAULT_CAPS } from "../src/cost/ledger.mjs"
import { monthToDate, projectedSpend, assertWithinBudget } from "../src/cost/budget.mjs"
import { loadMapping, resolve, loadCatalog, drift } from "../src/cost/catalog.mjs"

const temp = () => mkdtempSync(join(tmpdir(), "evals-ledger-"))
const NOW = new Date("2026-11-11T12:00:00Z")

test("caps: 800 per plugin and 13000 in total a month by default, then caps.json, then the environment", () => {
  const store = temp()
  assert.deepEqual({ ...loadCaps(store, {}), source: undefined }, { ...DEFAULT_CAPS, per_plugin_iteration: 800, total_iteration: 13000, source: undefined })
  writeFileSync(join(store, "caps.json"), JSON.stringify({ per_plugin_month: 100, total_iteration: 50 }))
  const fromFile = loadCaps(store, {})
  assert.equal(fromFile.per_plugin_month, 100)
  assert.equal(fromFile.per_plugin_iteration, 100, "an unset iteration cap is the month's")
  assert.equal(fromFile.total_iteration, 50)
  assert.equal(loadCaps(store, { EVALS_MAX_RUNS_PER_PLUGIN: "7" }).per_plugin_month, 7)
  assert.throws(() => loadCaps(store, { EVALS_MAX_RUNS_TOTAL: "lots" }), /whole number/)
  rmSync(store, { recursive: true, force: true })
})

test("a batch that would cross a cap reserves nothing; one that fits reserves all its runs", () => {
  const store = temp()
  const env = { EVALS_MAX_RUNS_PER_PLUGIN: "10", EVALS_MAX_RUNS_TOTAL: "15" }
  const first = reserve(store, { plugin: "history", iteration: "a", runs: 8, now: NOW, env })
  assert.equal(first.month, "2026-11")
  assert.throws(() => reserve(store, { plugin: "history", iteration: "b", runs: 3, now: NOW, env }), (error) => error instanceof CapError && /history would reach 11 of 10 runs in 2026-11/.test(error.message))
  assert.equal(readLedger(store).filter((e) => e.kind === "reserve").length, 1, "the refused batch left no reservation")
  reserve(store, { plugin: "x", iteration: "c", runs: 7, now: NOW, env })
  assert.throws(() => reserve(store, { plugin: "linear", iteration: "d", runs: 1, now: NOW, env }), /all plugins would reach 16 of 15/)
  // Next month starts empty: the caps are monthly.
  reserve(store, { plugin: "history", iteration: "e", runs: 10, now: new Date("2026-12-01T00:00:00Z"), env })
  rmSync(store, { recursive: true, force: true })
})

test("released runs come back; a crashed batch keeps its reservation; iteration caps count the iteration", () => {
  const store = temp()
  const env = { EVALS_MAX_RUNS_PER_PLUGIN: "10", EVALS_MAX_RUNS_PER_ITERATION: "4" }
  const { batch } = reserve(store, { plugin: "history", iteration: "it", runs: 4, now: NOW, env })
  assert.throws(() => reserve(store, { plugin: "history", iteration: "it", runs: 1, now: NOW, env }), /iteration it would reach 5 of 4/)
  release(store, batch, 2)
  reserve(store, { plugin: "history", iteration: "it", runs: 2, now: NOW, env })
  assert.deepEqual(usage(readLedger(store), { month: "2026-11", plugin: "history", iteration: "it" }), { total_month: 4, per_plugin_month: 4, total_iteration: 4, per_plugin_iteration: 4 })
  rmSync(store, { recursive: true, force: true })
})

test("unpriced runs count against the run cap, and the month's dollars come from the ledger", () => {
  const store = temp()
  const { batch } = reserve(store, { plugin: "history", iteration: "sub", runs: 3, now: new Date(), env: {} })
  for (const trial of [1, 2, 3]) recordRun(store, { batch, month: new Date().toISOString().slice(0, 7), iteration: "sub", plugin: "history", case: "c", trial, exit: 0, billed_usd: 0, cost_source: "unpriced" })
  const mtd = monthToDate(store)
  assert.equal(mtd.ledger_runs, 3)
  assert.equal(mtd.unknown_cost_runs, 3)
  assert.equal(mtd.model_usd, 0)
  assert.deepEqual(projectedSpend(store, 100), { model_usd: 0, basis: "no priced run this month" })
  assert.equal(checkCaps(readLedger(store), { per_plugin_month: 3, total_month: 99, per_plugin_iteration: 99, total_iteration: 99 }, { month: new Date().toISOString().slice(0, 7), plugin: "history", iteration: "next", runs: 0 }).per_plugin_month, 3)
  assert.throws(() => checkCaps(readLedger(store), { per_plugin_month: 3, total_month: 99, per_plugin_iteration: 99, total_iteration: 99 }, { month: new Date().toISOString().slice(0, 7), plugin: "history", iteration: "next", runs: 1 }), CapError, "three $0 runs still used three runs")
  rmSync(store, { recursive: true, force: true })
})

test("billed runs project the next batch's spend, and the dollar cap refuses it", () => {
  const store = temp()
  const month = new Date().toISOString().slice(0, 7)
  const { batch } = reserve(store, { plugin: "x", iteration: "paid", runs: 2, now: new Date(), env: {} })
  recordRun(store, { batch, month, iteration: "paid", plugin: "x", case: "c", trial: 1, billed_usd: 2, cost_source: "billed" })
  recordRun(store, { batch, month, iteration: "paid", plugin: "x", case: "c", trial: 2, billed_usd: 4, cost_source: "billed" })
  const projected = projectedSpend(store, 10)
  assert.equal(projected.model_usd, 30)
  assert.throws(() => assertWithinBudget(store, { model_usd: projected.model_usd }), /model spend would reach \$36\.00/)
  assert.doesNotThrow(() => assertWithinBudget(store, { model_usd: 1 }))
  rmSync(store, { recursive: true, force: true })
})

test("the ledger lock is exclusive, and a stale one is taken over", () => {
  const store = temp()
  mkdirSync(join(store, "ledger"), { recursive: true })
  writeFileSync(join(store, "ledger", "lock"), "99999")
  assert.throws(() => withLock(store, () => 1, { timeoutMs: 120, staleMs: 60_000 }), /locked/)
  assert.equal(withLock(store, () => 2, { timeoutMs: 120, staleMs: 0 }), 2)
  rmSync(store, { recursive: true, force: true })
})

test("claude-agent/haiku maps to a catalogue model, so a list price can be found once the catalogue is present", () => {
  const mapping = loadMapping({})
  assert.equal(mapping["claude-agent/haiku"].to, "anthropic/claude-haiku-5-5")
  const catalog = { providers: { anthropic: { models: { "claude-haiku-5-5": { cost: { input: 1, output: 5 }, release_date: "2026-10-01" }, "claude-opus-6": { cost: { input: 5, output: 25 }, release_date: "2026-11-10" } } } } }
  const resolved = resolve(catalog, "claude-agent", "haiku", mapping)
  assert.equal(resolved.via, "mapping")
  assert.equal(resolved.price.input, 1)
  const entries = drift(catalog, mapping)
  assert.equal(entries.find((e) => e.alias === "claude-agent/haiku").stale, false, "a newer Opus says nothing about the Haiku alias")
  assert.equal(entries.find((e) => e.alias === "claude-agent/opus").stale, true)
  assert.deepEqual(loadCatalog({ EVALS_MODELS_CATALOG: "/nonexistent" }).providers, {})
})

test("the dollar caps are the caller's, and a cap that is not a number is an error, not NaN", async () => {
  const { budgetCaps } = await import("../src/cost/budget.mjs")
  assert.deepEqual(budgetCaps({}), { model_usd: 25, vendor_usd: 10 })
  assert.deepEqual(budgetCaps({ EVALS_BUDGET_MODEL_USD: "3.5", EVALS_BUDGET_VENDOR_USD: "" }), { model_usd: 3.5, vendor_usd: 10 })
  assert.throws(() => budgetCaps({ EVALS_BUDGET_MODEL_USD: "lots" }), /EVALS_BUDGET_MODEL_USD must be a number of dollars/)
  assert.throws(() => budgetCaps({ EVALS_BUDGET_VENDOR_USD: "-1" }), /EVALS_BUDGET_VENDOR_USD/)
  const store = temp()
  assert.throws(() => assertWithinBudget(store, { model_usd: 2 }, { EVALS_BUDGET_MODEL_USD: "1" }), /would reach \$2\.00 of \$1/)
  assert.doesNotThrow(() => assertWithinBudget(store, { model_usd: 2 }, { EVALS_BUDGET_MODEL_USD: "5" }))
  rmSync(store, { recursive: true, force: true })
})

test("the dollar check runs inside the ledger lock: a batch it refuses reserves nothing", () => {
  const store = temp()
  assert.throws(() => reserve(store, { plugin: "x", iteration: "i", runs: 1, env: {}, check: () => { throw new Error("D4 budget: no") } }), /D4 budget/)
  assert.deepEqual(readLedger(store), [])
  rmSync(store, { recursive: true, force: true })
})

test("the lock is taken atomically, and breaking a stale one can never remove a live holder's", async () => {
  const { acquireLock, breakStaleLock, releaseLock } = await import("../src/cost/ledger.mjs")
  const dir = temp()
  const lock = join(dir, "lock")
  assert.equal(acquireLock(lock, "A"), true)
  assert.equal(acquireLock(lock, "B"), false, "one holder at a time")
  // B and C both saw A's lock as stale. B breaks it and takes the lock; C's break then finds B's token, not A's,
  // and puts B's lock back.
  assert.equal(breakStaleLock(lock, "A", "B"), true)
  assert.equal(acquireLock(lock, "B"), true)
  assert.equal(breakStaleLock(lock, "A", "C"), false)
  assert.equal(readFileSync(lock, "utf8"), "B", "B still holds the lock")
  releaseLock(lock, "C")
  assert.equal(readFileSync(lock, "utf8"), "B", "a release by someone else removes nothing")
  releaseLock(lock, "B")
  assert.equal(existsSync(lock), false)
  assert.deepEqual(readdirSync(dir), [], "no private files left behind")
  rmSync(dir, { recursive: true, force: true })
})

test("two batches at once: the second's dollar check counts the first's reserved runs before they bill", async () => {
  const { assertBatchWithinBudget, budgetLine } = await import("../src/cost/budget.mjs")
  const { outstanding } = await import("../src/cost/ledger.mjs")
  const store = temp()
  const env = { EVALS_BUDGET_MODEL_USD: "10" }
  const check = (runs, perRunUsd) => () => assertBatchWithinBudget(store, { runs, perRunUsd }, env)
  // A reserves 3 runs at $2: $6 expected, nothing billed yet.
  const a = reserve(store, { plugin: "x", iteration: "a", runs: 3, model: "m/x", perRunUsd: 2, env, check: check(3, 2) })
  assert.equal(outstanding(readLedger(store)).usd, 6)
  // B wants 3 more at $2: $6 reserved + $6 = $12 over $10, though nothing has billed. Refused, nothing reserved.
  assert.throws(() => reserve(store, { plugin: "y", iteration: "b", runs: 3, model: "m/x", perRunUsd: 2, env, check: check(3, 2) }), /would reach \$12\.00 of \$10 .*\$6\.00 reserved by batches still running/)
  assert.equal(readLedger(store).filter((e) => e.kind === "reserve").length, 1)
  // A's runs bill $2 each: committed $6, outstanding $0; B's 2 runs make $10, within the cap.
  const month = new Date().toISOString().slice(0, 7)
  for (const trial of [1, 2, 3]) recordRun(store, { batch: a.batch, month, iteration: "a", plugin: "x", model: "m/x", case: "c", trial, billed_usd: 2, cost_source: "billed" })
  assert.equal(outstanding(readLedger(store)).usd, 0)
  assert.doesNotThrow(() => reserve(store, { plugin: "y", iteration: "b", runs: 2, model: "m/x", perRunUsd: 2, env, check: check(2, 2) }))
  // A batch with no price is reserved, counted as unpriced, and the budget line says the cap is not enforceable for it.
  const free = reserve(store, { plugin: "z", iteration: "c", runs: 4, model: "m/unpriced", perRunUsd: null, env, check: check(4, null) })
  assert.equal(free.dollars.enforceable, false)
  assert.equal(outstanding(readLedger(store)).unpriced, 4)
  assert.match(budgetLine(store), /4 of them have no price, so the dollar cap is not enforceable for them and the run caps alone apply/)
  rmSync(store, { recursive: true, force: true })
})

test("a run's price comes from billed runs, then the catalogue for recorded tokens, then an assumption, else none", async () => {
  const { projectedRunUsd } = await import("../src/cost/budget.mjs")
  const store = temp()
  const month = new Date().toISOString().slice(0, 7)
  const catalogFile = join(store, "models.json")
  writeFileSync(catalogFile, JSON.stringify({ anthropic: { models: { "claude-haiku-5-5": { cost: { input: 1, output: 5, cache_read: 0.1, cache_write: 1.25 } } } } }))
  const env = { EVALS_MODELS_CATALOG: catalogFile }
  assert.equal(projectedRunUsd(store, "claude-agent/haiku", env).usd, null, "no run recorded yet: nothing to price tokens by")
  recordRun(store, { batch: "b", month, model: "claude-agent/haiku", billed_usd: 0, cost_source: "unpriced", tokens: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } })
  const listed = projectedRunUsd(store, "claude-agent/haiku", env)
  assert.equal(listed.usd, 1)
  assert.match(listed.basis, /list price/)
  assert.deepEqual(projectedRunUsd(store, "other/model", { EVALS_ASSUMED_RUN_USD: "0.25" }), { usd: 0.25, basis: "assumed (EVALS_ASSUMED_RUN_USD)" })
  writeFileSync(join(store, "caps.json"), JSON.stringify({ assumed_run_usd: { "other/model": 0.4 } }))
  assert.equal(projectedRunUsd(store, "other/model", {}).usd, 0.4)
  assert.match(projectedRunUsd(store, "third/model", {}).basis, /no price for third\/model/)
  recordRun(store, { batch: "b", month, model: "other/model", billed_usd: 3, cost_source: "billed" })
  assert.equal(projectedRunUsd(store, "other/model", {}).usd, 3, "what this month's runs billed wins")
  rmSync(store, { recursive: true, force: true })
})
