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

// The expected counts are worked out here, from each compiled case's own metadata, by the rules in src/case/sets.mjs's header: a test that pinned "83 cases" broke
// for every pull request that added a History case. Nothing in it is a number of the corpus.
test("the History sets are the phase B design's, from each case's own metadata; retired cases are in no set", () => {
  const cases = historyCases()
  const isActive = (c) => (c.status ?? "active") === "active"
  const retired = cases.filter((c) => !isActive(c))
  const active = cases.filter(isActive)
  const holdout = (c) => c.holdout === true || /^hold-/.test(c.id)
  const ROUND = ["wide", "route", "deep", "commit", "hooks", "local"]
  const family = (c) => (holdout(c) ? "holdout" : /^tools-/.test(c.id) ? "tools" : (c.sets ?? []).some((n) => ROUND.includes(n)) ? "round" : "tune")
  const inFamily = (name) => active.filter((c) => family(c) === name)
  const named = (name) => active.filter((c) => !holdout(c) && (c.sets ?? []).includes(name))
  const expected = { tune: inFamily("tune").length, holdout: inFamily("holdout").length, tools: inFamily("tools").length }
  for (const name of new Set(active.filter((c) => !holdout(c)).flatMap((c) => c.sets ?? []))) expected[name] = named(name).length
  assert.deepEqual(setCounts(cases), expected)
  assert.ok(Object.values(setCounts(cases)).every(Number.isFinite), "every count is a number")
  assert.ok(retired.length === 0 || retired.every((c) => !selectCases(active, { set: "all" }).selected.some((x) => x.id === c.id)))
  const ids = (list) => list.map((c) => c.id).sort()
  assert.deepEqual(ids(selectCases(cases).selected), ids(inFamily("tune")), "the default set is tune, without the tools-* family")
  assert.deepEqual(ids(selectCases(cases, { set: "all" }).selected), ids([...inFamily("tune"), ...inFamily("tools")]), "all is tune and tools: no retired case, no holdout")
  const union = active.filter((c) => !holdout(c) && (c.sets ?? []).some((n) => ["core", "guard", "smoke"].includes(n)))
  assert.deepEqual(ids(selectCases(cases, { set: "core,guard,smoke" }).selected), ids(union))
  if (expected.smoke) assert.deepEqual(selectCases(cases, { set: "smoke" }).selected.map(familyOf), Array(expected.smoke).fill("tools"))
  const core = new Set(selectCases(cases, { set: "core" }).selected.map((c) => c.id))
  for (const name of ["safety", "screen"]) if (expected[name]) assert.ok(selectCases(cases, { set: name }).selected.every((c) => core.has(c.id)), `${name} is inside core`)
  // a retired case named outright is an error that says so, whichever one it is
  if (retired.length) assert.throws(() => selectCases(cases, { patterns: retired[0].id, set: "all" }), /status retired/)
})

test("a named case outside the set is an error that says which set it is in", () => {
  const cases = [{ id: "a" }, { id: "ho-b", holdout: true }, { id: "tools-c" }]
  assert.throws(() => selectCases(cases, { patterns: "ho-b" }), /in holdout, not in --set tune/)
  assert.deepEqual(selectCases(cases, { patterns: "ho-b,a", set: "all" }).selected.map((c) => c.id), ["a"], "all is tune and tools: a holdout is not in it")
  assert.deepEqual(selectCases(cases, { patterns: "ho-b,a", set: "all,holdout" }).selected.map((c) => c.id), ["a", "ho-b"])
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
  assert.deepEqual(selectCases(cases, { set: "core" }).selected.map((c) => c.id), ["a", "b"], "a holdout in a plugin's own set is not in it: only naming holdout selects one")
  assert.deepEqual(selectCases(cases, { set: "core,holdout" }).selected.map((c) => c.id), ["a", "b", "ho-e"])
  assert.deepEqual(selectCases(cases, { set: "smoke" }).selected.map((c) => c.id), ["a"])
  assert.deepEqual(selectCases(cases, { set: "tune" }).selected.map((c) => c.id), ["a", "b", "d"])
  assert.throws(() => selectCases(cases, { set: "guard" }), /status deferred/)
  assert.throws(() => selectCases(cases, { set: "nightly" }), /unknown case set nightly/)
  assert.deepEqual(setCounts(cases), { tune: 3, holdout: 1, tools: 0, core: 2, smoke: 1 }, "a holdout is counted as a holdout and under no other set")
})

test("each comparison's seed is derived from its own arms and cases, and pinned", () => {
  const base = arm("base", "b1", [0, 1, 1, 2, 0, 3, 1, 0])
  const next = arm("next", "n1", [2, 3, 1, 3, 2, 3, 3, 1])
  const other = arm("other", "o1", [3, 3, 3, 3, 3, 3, 3, 3])
  const c = compare([base, next]).comparisons[0]
  // The seed is sha256("<a iterations>|<b iterations>|<shared case ids>"), first 32 bits.
  assert.equal(c.seed, seedOf("b1|n1|c0,c1,c2,c3,c4,c5,c6,c7"))
  assert.equal(c.seed, 3499925043)
  assert.equal(compare([base, other]).comparisons[0].seed, 3542987912, "another comparison, another stream")
  // And what the stream gives: a fixed seed shared by every comparison would not give this interval.
  assert.deepEqual([c.mean, c.lo, c.hi], [0.4166666666666667, 0.20833333333333334, 0.5833333333333334])
})

test("setCounts counts every set a case can declare, round sets included, as numbers, and counts a holdout as a holdout only", () => {
  // the shape of the NaN: a round-set case's family is `round`, which was not a key, so `counts.round++` made NaN
  const cases = [
    { id: "tools-a", sets: ["wide"] },
    { id: "tools-b", sets: ["wide"] },
    { id: "route-no-1", sets: ["route"] },
    { id: "deep-a", sets: ["deep"] },
    { id: "deep-b", sets: ["deep", "local"] },
    { id: "commit-a", sets: ["commit"] },
    { id: "hook-a", sets: ["hooks"] },
    { id: "anything", sets: ["local"] },
    { id: "plain" },
    { id: "own", sets: ["local", "core"] },
    { id: "retired-wide", sets: ["wide"], status: "retired" },
    { id: "deferred-deep", sets: ["deep"], status: "deferred" },
    // holdouts, however they are marked or whatever Set they were given to get past the old id rule
    { id: "hold-slack-1-a", holdout: true, sets: ["local"] },
    { id: "hold-slack-2-b", holdout: true, sets: ["wide"] },
    { id: "hold-slack-3-c", holdout: true },
    { id: "hold-slack-4-d", sets: ["deep", "core"] },
  ]
  const counts = setCounts(cases)
  assert.deepEqual(counts, { tune: 1, holdout: 4, tools: 2, wide: 2, route: 1, deep: 2, commit: 1, hooks: 1, local: 3, core: 1 })
  assert.ok(Object.values(counts).every((n) => Number.isInteger(n)), "no NaN")
  assert.equal("round" in counts, false, "`round` is not a selection")
  for (const name of ["wide", "route", "deep", "commit", "hooks", "local"]) assert.equal(Number.isInteger(setCounts([{ id: name === "wide" ? "tools-x" : `${name}-x`, sets: [name] }])[name]), true, name)
  // and the counts are what selectCases returns for each name (a holdout in none of them)
  for (const [name, n] of Object.entries(counts)) {
    if (["tune", "holdout", "tools"].includes(name)) continue
    assert.equal(selectCases(cases, { set: name }).selected.length, n, `--set ${name}`)
  }
  assert.equal(selectCases(cases, { set: "holdout" }).selected.length, counts.holdout)
  assert.equal(selectCases(cases, { set: "tools" }).selected.length, counts.tools)
})
