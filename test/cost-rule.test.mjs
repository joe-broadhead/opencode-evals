// The owner's cost rule: billed beats list, a subscription falls back to the catalogue, a catalogue zero is
// genuinely free, and an unknown model is missing — never zero, never a guess.
import { test } from "node:test"
import assert from "node:assert/strict"
import { classify, runCost, totals } from "../src/cost/rule.mjs"
import { resolve, listPrice, loadCatalog, catalogPath, loadMapping } from "../src/cost/catalog.mjs"

const tokens = { input: 1000, output: 2000, cacheRead: 100_000, cacheWrite: 4000 }
const price = { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25, per: "mtok" }

test("a provider-reported cost wins over the catalogue", () => {
  const verdict = classify({ billed: 0.42, tokens, price })
  assert.equal(verdict.source, "billed")
  assert.equal(verdict.amount_usd, 0.42)
})

test("a subscription that billed zero falls back to the list price, tagged", () => {
  const verdict = classify({ billed: 0, tokens, price })
  assert.equal(verdict.source, "list-price")
  // 1000×5 + 2000×25 + 100000×0.5 + 4000×6.25, per million tokens.
  assert.equal(verdict.amount_usd, (1000 * 5 + 2000 * 25 + 100_000 * 0.5 + 4000 * 6.25) / 1_000_000)
  assert.ok(verdict.amount_usd > 0)
})

test("a null billed cost behaves like zero", () => {
  assert.equal(classify({ billed: null, tokens, price }).source, "list-price")
})

test("a catalogue price of zero is genuinely free, not missing", () => {
  const free = { input: 0, output: 0, cache_read: 0, cache_write: 0, per: "mtok" }
  const verdict = classify({ billed: 0, tokens, price: free })
  assert.equal(verdict.source, "free")
  assert.equal(verdict.amount_usd, 0)
})

test("an unknown model is missing, and never counted as zero", () => {
  const verdict = classify({ billed: null, tokens, price: null })
  assert.equal(verdict.source, "missing")
  assert.equal(verdict.amount_usd, null)
  const only = totals([verdict])
  assert.equal(only.billed_usd, null)
  assert.equal(only.list_usd, null)
  assert.equal(only.missing_runs, 1)
})

test("the catalogue ladder: exact, mapping, unique model id, then missing", () => {
  const catalog = {
    providers: {
      "vendor-one": { models: { "big-model": { cost: { input: 3, output: 15, cache_read: 0.3, cache_write: 3.75 } } } },
      "vendor-two": { models: { unique: { cost: { input: 1, output: 2, cache_read: 0.1, cache_write: 0.2 } } } },
      "vendor-three": { models: { unique: { cost: { input: 1, output: 2 } } } },
    },
  }
  const exact = resolve(catalog, "vendor-one", "big-model#high")
  assert.equal(exact.via, "exact")
  assert.equal(exact.price.input, 3)
  assert.equal(exact.price.cache_read, 0.3)

  const mapped = resolve(catalog, "some-alias", "big", { "some-alias/big": "vendor-one/big-model" })
  assert.equal(mapped.via, "mapping")

  const ambiguous = resolve(catalog, "vendor-one", "unique")
  assert.equal(ambiguous.source, "missing")
  assert.match(ambiguous.why, /ambiguous/)

  const absent = resolve(catalog, "nobody", "nothing")
  assert.equal(absent.source, "missing")
})

test("a model id only one provider prices resolves through it", () => {
  const catalog = { providers: { "vendor-one": { models: { solo: { cost: { input: 2, output: 4 } } } }, "vendor-two": { models: {} } } }
  const found = resolve(catalog, "some-alias", "solo")
  assert.equal(found.via, "model-id")
  assert.equal(found.provider, "vendor-one")
})

test("run cost sums the steps, keeps billed and list apart, and names the catalogue", () => {
  const catalog = { providers: { p: { models: { m: { cost: price } } } }, digest: "d".repeat(64), fetched_at: "2026-11-07T00:00:00Z" }
  const run = runCost({
    steps: [
      { cost: 0, tokens: { input: 500, output: 1000, cache: { read: 50_000, write: 2000 } } },
      { cost: 0, tokens: { input: 500, output: 1000, cache: { read: 50_000, write: 2000 } } },
    ],
    model: { provider: "p", id: "m" },
    catalog,
    mapping: {},
  })
  assert.equal(run.billed_usd, 0)
  assert.equal(run.billed_steps, 2)
  assert.equal(run.source, "list-price")
  assert.deepEqual(run.tokens, { input: 1000, output: 2000, cacheRead: 100_000, cacheWrite: 4000 })
  assert.equal(run.catalog.digest, "d".repeat(64))
  assert.equal(run.amount_usd, (1000 * 5 + 2000 * 25 + 100_000 * 0.5 + 4000 * 6.25) / 1_000_000)
})

test("totals report both sides and the source mix", () => {
  const result = totals([
    { billed_usd: 0.1, source: "billed", tokens, resolved: { price } },
    { billed_usd: 0, source: "list-price", tokens, resolved: { price } },
    { billed_usd: null, source: "missing", tokens, resolved: {} },
  ])
  assert.equal(result.billed_usd, 0.1)
  assert.equal(result.billed_runs, 2)
  assert.equal(result.list_runs, 2)
  assert.equal(result.missing_runs, 1)
  assert.deepEqual(result.sources, { billed: 1, "list-price": 1, missing: 1 })
})

test("the live catalogue is read from OpenCode's own cache, with a digest", () => {
  const catalog = loadCatalog()
  assert.equal(typeof catalogPath(), "string")
  assert.equal(typeof loadMapping(), "object")
  if (catalog.digest) {
    assert.match(catalog.digest, /^[0-9a-f]{64}$/)
    assert.ok(Object.keys(catalog.providers).length > 0)
  }
  // No price is typed in this repository: the catalogue is the only source.
  assert.equal(listPrice(tokens, null), null)
})
