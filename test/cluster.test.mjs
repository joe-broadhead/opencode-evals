// R12: the case-cluster bootstrap with models and trials nested, fresh-trial baselines, the pooled holdout gate and the adoption screen.
import { test } from "node:test"
import assert from "node:assert/strict"
import { clusterBootstrap, freshOnly, holdoutGate, adopt, paired, caseRate, casePasses, rng } from "../src/report/cluster.mjs"

const arm = (spec) => new Map(Object.entries(spec).map(([id, models]) => [id, new Map(Object.entries(models))]))
const cases = (n, f) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${String(i).padStart(2, "0")}`, f(i)]))

test("the interval is deterministic, centred on the paired difference, and collapses when every case moves the same way", () => {
  const a = arm(cases(12, () => ({ hk: [0, 0, 0], ds: [0, 0, 0] })))
  const b = arm(cases(12, () => ({ hk: [1, 1, 1], ds: [1, 1, 1] })))
  const up = clusterBootstrap(a, b, { seed: "t" })
  assert.deepEqual([up.estimate, up.lo, up.hi, up.cases], [1, 1, 1, 12])
  assert.deepEqual(up.models, ["ds", "hk"])
  const same = clusterBootstrap(a, a, { seed: "t" })
  assert.deepEqual([same.estimate, same.lo, same.hi], [0, 0, 0])
  // a mixed arm: the estimate is the mean of the per-case differences, the same twice over, and the interval brackets it
  const noisy = arm(cases(20, (i) => ({ hk: i % 4 === 0 ? [1, 1, 0] : [0, 0, 0], ds: [0, 0, 0] })))
  const base = arm(cases(20, () => ({ hk: [0, 0, 0], ds: [0, 0, 0] })))
  const r1 = clusterBootstrap(base, noisy, { seed: "t" })
  const r2 = clusterBootstrap(base, noisy, { seed: "t" })
  assert.deepEqual(r1, r2)
  assert.ok(Math.abs(r1.estimate - (5 * (2 / 3)) / 20 / 2) < 1e-9, String(r1.estimate))
  assert.ok(r1.lo <= r1.estimate && r1.estimate <= r1.hi && r1.lo > 0, `${r1.lo} ${r1.estimate} ${r1.hi}`)
  assert.notEqual(rng("one")(), rng("other")(), "another seed, another stream (the interval itself sits on a coarse lattice, so two seeds can agree)")
})

test("cases are the unit: few cases give a wide interval that includes zero even when every trial agrees", () => {
  const a = arm({ c0: { hk: [0, 0, 0, 0, 0, 0] }, c1: { hk: [1, 1, 1, 1, 1, 1] } })
  const b = arm({ c0: { hk: [1, 1, 1, 1, 1, 1] }, c1: { hk: [1, 1, 1, 1, 1, 1] } })
  const r = clusterBootstrap(a, b, { seed: "few" })
  assert.equal(r.estimate, 0.5)
  assert.equal(r.lo, 0, "twelve trials of two cases are two cases: the draw that picks only c1 twice sees no gain")
  assert.equal(r.cases, 2)
})

test("only the cases and the models both arms ran are compared", () => {
  const a = arm({ c0: { hk: [1], ds: [0] }, c1: { hk: [1] }, only_a: { hk: [1] } })
  const b = arm({ c0: { hk: [1] }, c1: { hk: [0], ds: [1] }, only_b: { hk: [1] } })
  const p = paired(a, b)
  assert.deepEqual(p.map((x) => x.id), ["c0", "c1"])
  assert.deepEqual([...p[0].models], ["hk"], "ds is in a's c0 and not b's")
  assert.deepEqual([...p[1].models], ["hk"])
  assert.equal(clusterBootstrap(arm({ x: { hk: [1] } }), arm({ y: { hk: [1] } })).estimate, null)
  assert.equal(caseRate(new Map([["hk", [1, 0]], ["ds", [1, 1]]])), 0.75, "models are weighted equally")
  assert.equal(caseRate(new Map([["hk", [1, 0]], ["ds", [1, 1]]]), { only: new Set(["ds"]) }), 1)
})

test("the trials that selected a case are left out of the baseline, and a case or model with none left drops out", () => {
  const baseline = arm({ c0: { hk: [0, 1, 1], ds: [0] }, c1: { hk: [1, 1] } })
  const fresh = freshOnly(baseline, new Set(["c0#hk#1", "c0#ds#1"]))
  assert.deepEqual([...fresh.get("c0").get("hk")], [1, 1])
  assert.equal(fresh.get("c0").has("ds"), false, "the only trial of ds was the selecting one")
  assert.deepEqual([...fresh.get("c1").get("hk")], [1, 1])
  assert.equal(freshOnly(arm({ c0: { hk: [0] } }), new Set(["c0#hk#1"])).size, 0)
  // regression to the mean: a case chosen for failing looks better on fresh trials than on the one that chose it
  const chosen = arm(cases(30, () => ({ hk: [0, 1, 1] })))
  const sel = new Set(Object.keys(cases(30, () => 0)).map((id) => `${id}#hk#1`))
  assert.equal(caseRate(chosen.get("c00")), 2 / 3)
  assert.equal(caseRate(freshOnly(chosen, sel).get("c00")), 1)
})

test("the holdout gate: a pooled drop fails it, one flipped holdout is noise, two hold the plugin", () => {
  const plugin = (id) => id.split("-")[1]
  const mk = (rows) => arm(Object.fromEntries(rows.map(([id, hk, ds]) => [id, { hk, ds }])))
  const names = ["hold-slack-1", "hold-slack-2", "hold-slack-3", "hold-slack-4", "hold-linear-1", "hold-linear-2", "hold-linear-3", "hold-linear-4"]
  const cb = mk(names.map((id) => [id, [1, 1, 1], [1, 1, 1]]))
  const same = holdoutGate(cb, cb, { plugin })
  assert.equal(same.ok, true)
  assert.deepEqual(same.held, [])
  // one slack holdout flips: held by nobody
  const one = mk(names.map((id) => [id, id === "hold-slack-1" ? [0, 0, 0] : [1, 1, 1], id === "hold-slack-1" ? [0, 0, 0] : [1, 1, 1]]))
  assert.deepEqual(holdoutGate(one, cb, { plugin }).held, [])
  assert.deepEqual(holdoutGate(one, cb, { plugin }).flips, { slack: ["hold-slack-1"] })
  // two of one plugin's flip: that plugin is held
  const two = mk(names.map((id) => [id, /hold-slack-[12]/.test(id) ? [0, 0, 0] : [1, 1, 1], /hold-slack-[12]/.test(id) ? [0, 0, 0] : [1, 1, 1]]))
  const held = holdoutGate(two, cb, { plugin })
  assert.deepEqual(held.held, ["slack"])
  assert.equal(held.drops, true)
  assert.equal(held.ok, false, "the family's point estimate dropped")
  // a gain does not fail the gate, and an interval that reaches below -5 points does
  const better = holdoutGate(mk(names.map((id) => [id, [1, 1, 1], [1, 1, 1]])), mk(names.map((id) => [id, [0, 1, 1], [1, 1, 1]])), { plugin })
  assert.equal(better.ok, true)
})

test("the adoption screen names what a variant fails", () => {
  assert.deepEqual(adopt({ gain: { lo: 0.02 }, modelDrops: { hk: -3, ds: 2 }, tokensRise: 0.05 }), { adopt: true, why: [] })
  const bad = adopt({ gain: { lo: -0.01 }, modelDrops: { hk: -6 }, twinsDrop: true, newForbidden: 1, tokensRise: 0.2, budgetHolds: false })
  assert.equal(bad.adopt, false)
  assert.equal(bad.why.length, 6)
  assert.match(bad.why[0], /lower bound is -0\.01, not above 0/)
  assert.equal(adopt({ gain: null }).adopt, false)
  assert.equal(casePasses(new Map([["hk", [1, 0, 0]]])), false)
  assert.equal(casePasses(new Map()), null)
  const r = rng("x")
  assert.ok(r() !== r())
  assert.equal(rng("x")(), rng("x")(), "seeded")
})
