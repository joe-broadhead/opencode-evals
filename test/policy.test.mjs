import { test } from "node:test"
import assert from "node:assert/strict"
import { comparable } from "../src/policy/comparable.mjs"
import { decide, numericVerdict } from "../src/policy/decide.mjs"

const batch = (over = {}) => ({
  iteration: "b",
  coverage: { cases_declared: 12, cases_run: 12, items_executed: 69, items_testable: 69, items_passed: 66, items_blocked: 0 },
  cases: [],
  cost: { amount_usd: null, source: "missing" },
  provenance: {
    model: { value: "m", source: "declared" },
    opencode: { value: "2.2.5", source: "declared" },
    cases: { sha256: "a".repeat(64), source: "recorded", rule_set: "cap-and-tell-after" },
    skills: { sha256: "b".repeat(64), source: "recorded" },
    descriptions: { sha256: "e".repeat(64), source: "recorded" },
    namespace: { sha256: "f".repeat(64), source: "recorded" },
    tools: { sha256: "1".repeat(64), source: "recorded" },
    rules: { sha256: "2".repeat(64), source: "recorded" },
  },
  recordings_sha256: "c".repeat(64),
  trials: { min: 3, max: 3, runs: 36 },
  ...over,
})

test("a verified comparison on one axis is allowed", () => {
  const result = comparable(batch(), batch({ provenance: { ...batch().provenance, skills: { sha256: "d".repeat(64), source: "recorded" } } }), "skill")
  assert.equal(result.ok, true)
  assert.equal(result.basis, "verified")
})

test("an unrecorded case set is refused, and names the nx3r-nx5 lesson", () => {
  const a = batch({ provenance: { ...batch().provenance, cases: { sha256: null, source: "unrecorded" } } })
  const result = comparable(a, batch(), "skill")
  assert.equal(result.ok, false)
  assert.match(result.why.join(" "), /case set/)
  assert.match(result.why.join(" "), /nx3r/)
})

test("a rule change is a case-set change and is refused", () => {
  const a = batch({ provenance: { ...batch().provenance, cases: { sha256: null, source: "unrecorded", rule_set: "price-before-read" } } })
  const result = comparable(a, batch(), "skill")
  assert.equal(result.ok, false)
  assert.match(result.why.join(" "), /rule set/)
})

test("declared is an explicit override, and it says so", () => {
  const a = batch({ provenance: { ...batch().provenance, cases: { sha256: null, source: "unrecorded" } } })
  const result = comparable(a, batch(), "skill", { assume: "declared" })
  assert.equal(result.ok, true)
  assert.equal(result.basis, "declared")
  assert.match(result.why[0], /declared, not verified/)
})

test("an unrecorded description is refused: a description edit could explain the difference", () => {
  const a = batch({ provenance: { ...batch().provenance, descriptions: { sha256: null, source: "unrecorded" } } })
  const result = comparable(a, batch(), "skill")
  assert.equal(result.ok, false)
  assert.match(result.why.join(" "), /description is not recorded/)
})

test("a different model is refused even when the axis is the skill", () => {
  const result = comparable(batch(), batch({ provenance: { ...batch().provenance, model: { value: "other", source: "declared" } } }), "skill")
  assert.equal(result.ok, false)
  assert.match(result.why.join(" "), /model differs/)
})

test("decide holds on a new forbidden violation even when everything else improved", () => {
  const a = batch({ cases: [{ case: "c1", verdict: "PASS" }, { case: "c2", verdict: "FAIL", failed_blockers: ["X-PR01"] }] })
  const b = batch({ cases: [{ case: "c1", verdict: "FAIL", failed_blockers: ["X-SF01"], forbidden_violations: ["X-SF01"] }, { case: "c2", verdict: "PASS" }] })
  const verdict = decide({ comparison: comparable(a, b, "skill"), a, b })
  assert.equal(verdict.verdict, "hold")
  assert.match(verdict.reasons.join(" "), /regression/)
  assert.equal(verdict.numeric.fixes.length, 1)
})

test("decide ships a clean verified comparison", () => {
  const a = batch({ cases: [{ case: "c1", verdict: "FAIL", failed_majors: ["X-PR01"] }] })
  const b = batch({ cases: [{ case: "c1", verdict: "PASS" }] })
  const verdict = decide({ comparison: comparable(a, b, "skill"), a, b })
  assert.equal(verdict.verdict, "ship")
  assert.equal(verdict.numeric.fixes.length, 1)
})

test("decide asks when the basis is declared, and never ships on it", () => {
  const a = batch({ provenance: { ...batch().provenance, cases: { sha256: null, source: "unrecorded" } }, cases: [{ case: "c1", verdict: "FAIL" }] })
  const b = batch({ cases: [{ case: "c1", verdict: "PASS" }] })
  const verdict = decide({ comparison: comparable(a, b, "skill", { assume: "declared" }), a, b })
  assert.equal(verdict.verdict, "ask")
  assert.equal(verdict.basis, "declared")
})

test("a cost regression past the floor holds; a missing price is not a regression", () => {
  const a = batch({ cost: { amount_usd: 1, source: "table" }, coverage: { ...batch().coverage, items_passed: 10 } })
  const b = batch({ cost: { amount_usd: 2, source: "table" }, coverage: { ...batch().coverage, items_passed: 10 } })
  assert.equal(decide({ comparison: comparable(a, b, "skill"), a, b }).verdict, "hold")
  assert.equal(decide({ comparison: comparable(a, b, "skill"), a, b, noiseFloor: 1.5 }).verdict, "ship", "a higher noise floor tolerates more")
  const unknown = decide({ comparison: comparable(batch(), batch(), "skill"), a: batch(), b: batch() })
  assert.equal(unknown.verdict, "ship")
  assert.equal(unknown.numeric.costPerPass.delta, null)
})

test("thin coverage asks rather than shipping", () => {
  const b = batch({ coverage: { ...batch().coverage, cases_run: 5 } })
  const verdict = decide({ comparison: comparable(batch(), b, "skill"), a: batch(), b })
  assert.equal(verdict.verdict, "ask")
  assert.match(verdict.reasons.join(" "), /coverage 5\/12/)
})

test("plugin options are an axis: two arms that differ only in access compare on options, and on nothing else", async () => {
  const { DEFAULT_OPTIONS } = await import("../src/policy/comparable.mjs")
  const ask = batch({ provenance: { ...batch().provenance, options: { sha256: "9".repeat(64), source: "recorded", access: "ask-changes" } } })
  assert.equal(comparable(batch(), ask, "options").ok, true, "a batch without recorded options ran with none")
  const refused = comparable(batch(), ask, "skill")
  assert.equal(refused.ok, false)
  assert.match(refused.why.join(" "), /options differs/)
  assert.equal(comparable(batch(), batch({ provenance: { ...batch().provenance, options: { sha256: DEFAULT_OPTIONS, source: "default" } } }), "skill").ok, true)
})
