// Case sets from metadata, and arms compared over trials with a paired bootstrap whose stream is the comparison's own.
import { test } from "node:test"
import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { familyOf, selectCases, setCounts, parseSets } from "../src/case/sets.mjs"
import { rng, seedOf, pairedBootstrap, compare, summarizeArm, renderReport } from "../src/report/arms.mjs"

const historyCases = () => {
  const dir = join(import.meta.dirname, "..", "cases", "history")
  return readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")))
}

test("the History sets are 47 tune, 10 holdout and 9 tools cases, from each case's own metadata", () => {
  const cases = historyCases()
  assert.deepEqual(setCounts(cases), { tune: 47, holdout: 10, tools: 9 })
  assert.equal(selectCases(cases).selected.length, 47, "the default set is tune, without the tools-* family")
  assert.equal(selectCases(cases, { set: "tune,tools" }).selected.length, 56)
  assert.equal(selectCases(cases, { set: "all" }).selected.length, 66)
  assert.ok(selectCases(cases, { set: "holdout" }).selected.every((c) => c.holdout))
  assert.deepEqual(selectCases(cases, { patterns: "tools-*", set: "tools" }).selected.map(familyOf), Array(9).fill("tools"))
})

test("a named case outside the set is an error that says which set it is in", () => {
  const cases = [{ id: "a" }, { id: "ho-b", holdout: true }, { id: "tools-c" }]
  assert.throws(() => selectCases(cases, { patterns: "ho-b" }), /in holdout, not in --set tune/)
  assert.deepEqual(selectCases(cases, { patterns: "ho-b,a", set: "all" }).selected.map((c) => c.id), ["a", "ho-b"])
  assert.throws(() => parseSets("tunes"), /unknown case set/)
})

test("the generator is deterministic per seed, and the seed is the comparison's", () => {
  const a = rng(7)
  const b = rng(7)
  assert.deepEqual([a(), a(), a()], [b(), b(), b()])
  assert.notEqual(seedOf("x|y|c1"), seedOf("x|z|c1"))
  const flat = pairedBootstrap([0.5, 0.5, 0.5], { resamples: 200, seed: 3 })
  assert.equal(flat.lo, 0.5)
  assert.equal(flat.hi, 0.5)
  assert.equal(flat.better, 3)
})

const run = (id, strict, trial = 1) => ({
  case: id,
  trial,
  verdict: "PASS",
  items: [{ id: "H-OC01", severity: "blocker", state: "pass" }, { id: "H-PR01", severity: "major", state: strict ? "pass" : "fail" }],
  budget: { outer_calls: 2, inner_calls: 1, wall_ms: 1000, tokens: 1000 },
})
const arm = (label, iteration, pattern) => ({
  label,
  iterations: [iteration],
  runs: pattern.flatMap((passes, index) => [0, 1, 2].map((t) => run(`c${index}`, t < passes, t + 1))),
})

test("an arm's interval does not move when another arm is listed beside it", () => {
  const base = arm("base", "b1", [0, 1, 1, 2, 0, 3, 1, 0])
  const next = arm("next", "n1", [2, 3, 1, 3, 2, 3, 3, 1])
  const other = arm("other", "o1", [3, 3, 3, 3, 3, 3, 3, 3])
  const alone = compare([base, next]).comparisons[0]
  const listed = compare([base, other, next]).comparisons.find((c) => c.b === "next")
  assert.deepEqual(listed, alone)
  assert.ok(alone.mean > 0 && alone.lo <= alone.mean && alone.mean <= alone.hi)
  assert.equal(alone.cases.length, 8)
})

test("strict pass and pass^k are per run and per case", () => {
  const summary = summarizeArm(arm("a", "i", [3, 0, 2]))
  assert.equal(summary.runs, 9)
  assert.equal(summary.strict, 5 / 9)
  assert.equal(summary.passK.strict, 1 / 3, "only the case whose three trials all passed")
  assert.equal(summary.blocker, 1, "no blocker failed in any run")
  assert.deepEqual(summary.trials, { min: 3, max: 3 })
  const text = renderReport(compare([arm("a", "i", [3, 0, 2]), arm("b", "j", [3, 3, 3])]))
  assert.match(text, /\| b \| 3 \| \+44\.4 pts \|/)
})

test("a plugin's own sets come from Set: headers, and a retired or deferred case is in none", () => {
  const cases = [
    { id: "a", sets: ["core", "smoke"] },
    { id: "b", sets: ["core"] },
    { id: "c", sets: ["guard"], status: "deferred" },
    { id: "d" },
    { id: "ho-e", holdout: true, sets: ["core"] },
  ]
  assert.deepEqual(selectCases(cases, { set: "core" }).selected.map((c) => c.id), ["a", "b", "ho-e"])
  assert.deepEqual(selectCases(cases, { set: "smoke" }).selected.map((c) => c.id), ["a"])
  assert.deepEqual(selectCases(cases, { set: "tune" }).selected.map((c) => c.id), ["a", "b", "d"])
  assert.throws(() => selectCases(cases, { set: "guard" }), /status deferred/)
  assert.throws(() => selectCases(cases, { set: "nightly" }), /unknown case set nightly/)
  assert.deepEqual(setCounts(cases), { tune: 3, holdout: 1, tools: 0, core: 3, smoke: 1 })
})
