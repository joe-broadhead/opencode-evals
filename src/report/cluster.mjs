// R12: the statistics the round's decisions rest on (EVALS-232 §6.2).
//
//   clusterBootstrap   the strict-pass difference between two arms, resampling CASES (the unit a decision generalises over), with
//                      models and trials nested inside each case: a case drawn twice brings its models and its trials with it,
//                      and the trials of each model are themselves resampled. 5,000 resamples, a 95% percentile interval.
//   freshOnly          the baseline's trials with the ones that selected a case removed (a wide case chosen because one trial
//                      failed is compared on new trials, never on the one that chose it: regression to the mean)
//   holdoutGate        `h1` against its concurrent baseline `cb-h1`, pooled over the plugins: the family's point estimate must not
//                      drop and its lower bound must stay above -5 points; a plugin is held only when two or more of its holdouts
//                      flip from pass to fail
//   adopt              the adoption screen for a variant (a screen, not proof: the holdout confirms)
//
// An arm is a Map case -> Map model -> [outcomes 1|0, one per trial]. Pure and seeded: the same inputs give the same interval.

import { createHash } from "node:crypto"

export const RESAMPLES = 5000

/** A small seeded generator (mulberry32), seeded from any text, so a comparison's interval is the same wherever it is run. */
export function rng(seedText) {
  let a = createHash("sha256").update(String(seedText)).digest().readUInt32BE(0)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const mean = (xs) => (xs.length ? xs.reduce((n, x) => n + x, 0) / xs.length : null)
const draw = (xs, random) => xs.map(() => xs[Math.floor(random() * xs.length)])

/** One case's strict-pass rate in an arm: the models' rates, each over its trials, averaged with equal weight per model. */
export function caseRate(models, { random = null, only = null } = {}) {
  const rates = []
  for (const [model, trials] of models) {
    if (only && !only.has(model)) continue
    const outcomes = random ? draw(trials, random) : trials
    if (outcomes.length) rates.push(mean(outcomes))
  }
  return mean(rates)
}

/** The cases both arms ran, with the models both ran in each (a model one arm lacks is left out of that case in both). */
export function paired(a, b) {
  const out = []
  for (const [id, aModels] of a) {
    const bModels = b.get(id)
    if (!bModels) continue
    const shared = new Set([...aModels.keys()].filter((m) => bModels.has(m) && aModels.get(m).length && bModels.get(m).length))
    if (shared.size) out.push({ id, a: aModels, b: bModels, models: shared })
  }
  return out.sort((x, y) => x.id.localeCompare(y.id))
}

/**
 * B minus A in strict-pass rate, with a case-cluster bootstrap interval. Returns { estimate, lo, hi, cases, models, resamples },
 * or { estimate: null } when the arms share no case.
 */
export function clusterBootstrap(a, b, { resamples = RESAMPLES, seed = "cluster", level = 0.95 } = {}) {
  const pairs = paired(a, b)
  if (!pairs.length) return { estimate: null, lo: null, hi: null, cases: 0, models: [], resamples: 0 }
  const rate = (pair, arm, random) => caseRate(pair[arm], { random, only: pair.models })
  const estimate = mean(pairs.map((pair) => rate(pair, "b", null) - rate(pair, "a", null)))
  const random = rng(`${seed}|${pairs.map((p) => p.id).join(",")}`)
  const diffs = new Array(resamples)
  for (let r = 0; r < resamples; r++) {
    let total = 0
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[Math.floor(random() * pairs.length)]
      total += rate(pair, "b", random) - rate(pair, "a", random)
    }
    diffs[r] = total / pairs.length
  }
  diffs.sort((x, y) => x - y)
  const tail = (1 - level) / 2
  return { estimate, lo: diffs[Math.floor(tail * resamples)], hi: diffs[Math.min(resamples - 1, Math.ceil((1 - tail) * resamples) - 1)], cases: pairs.length, models: [...new Set(pairs.flatMap((p) => [...p.models]))].sort(), resamples }
}

/**
 * The arm with the trials that selected a case removed. `selecting` is a Set of `<case>#<model>#<trial index, from 1>`; a case or
 * model left with no trial drops out. A wide case chosen because a trial failed must be compared on fresh trials.
 */
export function freshOnly(arm, selecting) {
  const out = new Map()
  for (const [id, models] of arm) {
    const kept = new Map()
    for (const [model, trials] of models) {
      const fresh = trials.filter((_, index) => !selecting.has(`${id}#${model}#${index + 1}`))
      if (fresh.length) kept.set(model, fresh)
    }
    if (kept.size) out.set(id, kept)
  }
  return out
}

/** A case passes in an arm when most of its pooled (model x trial) runs pass. */
export function casePasses(models) {
  const all = [...models.values()].flat()
  return all.length ? mean(all) >= 0.5 : null
}

/**
 * The pooled holdout gate. `h1` and `cb` are arms over the same holdout cases; `plugin` maps a case id to its plugin.
 * Returns { ok, pooled: {estimate, lo, hi}, drops, held: [plugin], flips: {plugin: [case]} }.
 */
export function holdoutGate(h1, cb, { plugin = (id) => id.split("-")[1], seed = "h1" } = {}) {
  const pooled = clusterBootstrap(cb, h1, { seed })
  const flips = {}
  for (const [id, models] of h1) {
    const base = cb.get(id)
    if (!base) continue
    if (casePasses(base) === true && casePasses(models) === false) (flips[plugin(id)] ??= []).push(id)
  }
  const held = Object.entries(flips).filter(([, ids]) => ids.length >= 2).map(([name]) => name).sort()
  const drops = pooled.estimate !== null && pooled.estimate < 0
  const ok = pooled.estimate !== null && !drops && pooled.lo > -0.05
  return { ok, pooled, drops, held, flips }
}

/**
 * The adoption screen for a variant (§6.2 item 7). Every field is a measured fact the caller passes in:
 *   gain {lo}               the cluster-bootstrap lower bound of the strict-pass gain on the tune set
 *   modelDrops              each model's change in strict pass, in points (negative is a drop)
 *   twinsDrop               whether the paraphrase twins dropped
 *   newForbidden            new forbidden-action violations
 *   tokensRise              the fractional rise in tokens per run
 *   budgetHolds             whether the always-on budget held
 * Returns { adopt, why: [what failed] }. A screen, not proof: with up to 24 variants some passes are chance, so the holdout confirms.
 */
export function adopt({ gain, modelDrops = {}, twinsDrop = false, newForbidden = 0, tokensRise = 0, budgetHolds = true }) {
  const why = []
  if (!(typeof gain?.lo === "number" && gain.lo > 0)) why.push(`the gain's lower bound is ${gain?.lo ?? "unknown"}, not above 0`)
  for (const [model, drop] of Object.entries(modelDrops)) if (drop < -5) why.push(`${model} drops ${Math.abs(drop)} points (more than 5)`)
  if (twinsDrop) why.push("the paraphrase twins dropped: the variant fits its own wording")
  if (newForbidden > 0) why.push(`${newForbidden} new forbidden violation(s)`)
  if (tokensRise > 0.1) why.push(`tokens rise ${(tokensRise * 100).toFixed(0)}% (more than 10%)`)
  if (!budgetHolds) why.push("the always-on budget does not hold")
  return { adopt: why.length === 0, why }
}
