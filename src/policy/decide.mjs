// decide(): promotion, pure and unit-testable. No I/O, no clock, no model. It takes two batch summaries
// and a comparability result, and returns a verdict with its reasons. The thresholds are here, in one
// function, so a threshold change is a test change.

export const LIMITS = {
  /** A cost regression larger than this is real; ours is the granola control's +-20% duration floor. */
  costRegression: 0.25,
  /** A case that was passing and now is not is a regression, full stop. */
  caseRegression: "hold",
  /** Any forbidden violation is a hold; it is the one class that needs no statistics. */
  forbidden: "hold",
  /** Fewer than this many executed cases and the batch cannot support a claim. */
  minCoverage: 0.8,
  /**
   * Fewer trials per case than this and a model-driven comparison cannot ship: the same arm against itself flips a
   * case or two between trials. A grader comparison re-judges the same recordings and is exempt.
   */
  minTrials: 2,
}

const rate = (passed, total) => (total ? passed / total : null)
const pct = (value) => (value === null ? "n/a" : `${Math.round(value * 100)}%`)

/** @returns {{verdict: "ship"|"hold"|"ask", reasons: string[], numeric: object, basis: string}} */
export function decide({ comparison, a, b, noiseFloor = LIMITS.costRegression }) {
  const reasons = []
  const numeric = numericVerdict(a, b)
  if (!comparison.ok) {
    return {
      verdict: "hold",
      basis: "refused",
      reasons: [`not comparable: ${comparison.why.join("; ")}`, "the numeric delta below is advisory and cannot gate a release"],
      numeric,
    }
  }
  const blocking = [...numeric.caseRegressions, ...numeric.newForbidden, ...numeric.newBlockerFailures]
  if (blocking.length) reasons.push(`${blocking.length} regression(s): ${blocking.join(", ")}`)
  if (numeric.newMajorFailures.length) reasons.push(`new major finding(s): ${numeric.newMajorFailures.join(", ")}`)
  if (numeric.failedItems.length && !numeric.newMajorFailures.length && !numeric.newBlockerFailures.length) {
    reasons.push(`carried-over findings: ${numeric.failedItems.join(", ")}`)
  }

  // Both arms must be above the coverage floor, and their counts must be present, finite, nonnegative integers that
  // add up as the grader records them. A missing, fractional or impossible count cannot meet the floor.
  const coverage = b.coverage
  const coverageA = a.coverage
  const count = (value) => typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0
  const coverageProblem = (cov, label) => {
    if (!cov || typeof cov !== "object") return `${label} coverage is missing`
    const required = ["cases_declared", "cases_run", "items_executed", "items_testable", "items_passed", "items_blocked"]
    const bad = required.filter((key) => !count(cov[key]))
    if (bad.length) return `${label} coverage has no finite nonnegative integer ${bad.join(", ")}`
    if (cov.cases_run > cov.cases_declared) return `${label} coverage has cases_run ${cov.cases_run} > cases_declared ${cov.cases_declared}`
    if (cov.items_passed > cov.items_testable) return `${label} coverage has items_passed ${cov.items_passed} > items_testable ${cov.items_testable}`
    if (cov.items_testable + cov.items_blocked !== cov.items_executed) return `${label} coverage has items_executed ${cov.items_executed} != items_testable ${cov.items_testable} + items_blocked ${cov.items_blocked}`
    for (const key of ["items_na", "items_advisory"]) if (cov[key] !== undefined && !count(cov[key])) return `${label} coverage has an invalid ${key}`
    return null
  }
  const problemA = coverageProblem(coverageA, "arm a")
  const problemB = coverageProblem(coverage, "arm b")
  const shareOf = (cov) => (cov?.cases_declared ? cov.cases_run / cov.cases_declared : 0)
  const thinA = problemA !== null || shareOf(coverageA) < LIMITS.minCoverage
  const thinB = problemB !== null || shareOf(coverage) < LIMITS.minCoverage

  if (numeric.costPerPass.delta !== null && numeric.costPerPass.delta > Math.max(LIMITS.costRegression, noiseFloor)) {
    reasons.push(`cost per passing case worse by ${Math.round(numeric.costPerPass.delta * 100)}% (floor ${Math.round(Math.max(LIMITS.costRegression, noiseFloor) * 100)}%)`)
  }
  if (problemA) reasons.push(`arm a coverage invalid: ${problemA}`)
  else if (thinA) reasons.push(`arm a coverage ${coverageA?.cases_run ?? 0}/${coverageA?.cases_declared ?? 0} cases`)
  if (problemB) reasons.push(`arm b coverage invalid: ${problemB}`)
  else if (thinB) reasons.push(`arm b coverage ${coverage?.cases_run ?? 0}/${coverage?.cases_declared ?? 0} cases`)
  if (coverageA?.items_blocked > 0) reasons.push(`arm a: ${coverageA.items_blocked} item(s) unsettled (BLOCKED)`)
  if (coverage?.items_blocked > 0) reasons.push(`arm b: ${coverage.items_blocked} item(s) unsettled (BLOCKED)`)
  const fewTrials = comparison.axis !== "grader" && numeric.trials < LIMITS.minTrials
  if (fewTrials) reasons.push(`${numeric.trials} trial(s) per case: a model-driven comparison needs at least ${LIMITS.minTrials}, and one trial never ships`)

  let verdict
  if (blocking.length || reasons.some((r) => r.startsWith("cost per"))) verdict = "hold"
  else if (numeric.newMajorFailures.length || thinA || thinB || coverageA?.items_blocked > 0 || coverage?.items_blocked > 0 || comparison.basis !== "verified" || fewTrials) verdict = "ask"
  else verdict = "ship"

  if (verdict === "ship") reasons.push(`no regression; ${numeric.fixes} case(s) improved; ${numeric.passRate.delta === null ? "rates unchanged" : `pass rate ${pct(numeric.passRate.a)} -> ${pct(numeric.passRate.b)}`}`)
  if (verdict === "ask" && comparison.basis !== "verified") reasons.push(`basis is ${comparison.basis}: provenance is not verified`)
  return { verdict, basis: comparison.basis, reasons, numeric }
}

/** The numbers, computed the same whether or not the comparison is allowed to gate. */
export function numericVerdict(a, b) {
  const byCase = (batch) => new Map((batch.cases ?? []).map((c) => [c.case, c]))
  const A = byCase(a)
  const B = byCase(b)
  const shared = [...B.keys()].filter((id) => A.has(id))
  const caseRegressions = []
  const fixes = []
  for (const id of shared) {
    const before = A.get(id).verdict
    const after = B.get(id).verdict
    if (before === "PASS" && after !== "PASS") caseRegressions.push(`${id} ${before}->${after}`)
    if (before !== "PASS" && after === "PASS") fixes.push(id)
  }
  const newForbidden = []
  for (const id of shared) {
    const before = (A.get(id).forbidden_violations ?? []).length
    const after = (B.get(id).forbidden_violations ?? []).length
    if (after > before) newForbidden.push(`${id} ${after} violation(s)`)
  }
  const failedItems = [...B.values()].flatMap((c) => (c.failed ?? []).filter((id) => /^[A-Z]+-/.test(id)).map((id) => `${c.case}:${id}`))
  const newBlockerFailures = [...B.values()].flatMap((c) => {
    const before = new Set([...(A.get(c.case)?.failed_blockers ?? [])])
    return (c.failed_blockers ?? []).filter((id) => !before.has(id)).map((id) => `${c.case}:${id}`)
  })
  const newMajorFailures = [...B.values()].flatMap((c) => {
    const before = new Set([...(A.get(c.case)?.failed_majors ?? [])])
    return (c.failed_majors ?? []).filter((id) => !before.has(id)).map((id) => `${c.case}:${id}`)
  })
  const passRate = {
    a: rate(a.coverage?.items_passed, a.coverage?.items_testable),
    b: rate(b.coverage?.items_passed, b.coverage?.items_testable),
  }
  passRate.delta = passRate.a !== null && passRate.b !== null ? passRate.b - passRate.a : null
  // Cost per passing case: the passages we can actually compute, and nothing invented.
  const costA = a.cost?.amount_usd
  const costB = b.cost?.amount_usd
  const passA = a.coverage?.items_passed
  const passB = b.coverage?.items_passed
  let costPerPass = { a: null, b: null, delta: null }
  if (typeof costA === "number" && typeof costB === "number" && passA && passB) {
    const left = costA / passA
    const right = costB / passB
    costPerPass = { a: left, b: right, delta: left ? (right - left) / left : null }
  }
  // A batch graded before trials were recorded is one trial per case.
  const trials = Math.min(a.trials?.min || 1, b.trials?.min || 1)
  const strict = { a: a.strict?.rate ?? null, b: b.strict?.rate ?? null }
  strict.delta = strict.a !== null && strict.b !== null ? strict.b - strict.a : null
  const passK = { a: a.pass_k?.strict ?? null, b: b.pass_k?.strict ?? null }
  return { sharedCases: shared.length, caseRegressions, fixes, newForbidden, failedItems, newBlockerFailures, newMajorFailures, passRate, strict, passK, trials, costPerPass, costSource: b.cost?.source ?? "missing" }
}
