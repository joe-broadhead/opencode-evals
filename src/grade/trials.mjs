// Trials: one case run k times. A recording, a trace and a verdict each carry their trial index, and every trial is
// kept; a case's batch entry is the aggregate over its trials.
//
//   raw/<it>/<plugin>/<case>.t<k>.jsonl, traces/<it>/<plugin>/<case>.t<k>.trace.jsonl
//
// A name without `.t<k>` is a recording made before trials were kept per file: one trial, and its entries are left
// exactly as they were, so a batch graded before this module reproduces its digest.

const SUFFIX = /^(.*)\.t(\d+)$/

/** `case.t2` -> { case: "case", trial: 2, suffix: ".t2" }; `case` -> { case: "case", trial: null, suffix: "" }. */
export function splitTrial(name) {
  const match = SUFFIX.exec(name)
  if (!match) return { case: name, trial: null, suffix: "" }
  return { case: match[1], trial: Number(match[2]), suffix: `.t${match[2]}` }
}

export const trialName = (caseId, trial) => (trial ? `${caseId}.t${trial}` : caseId)

const PASSING = new Set(["pass", "na", "advisory"])

/**
 * Strict pass: every blocker and every major item passed (or was N/A or advisory). `PASS` only says no blocker failed,
 * so a run that dropped every citation (a major) still passes; strict is the bar a user feels.
 */
export const strictPass = (result) =>
  result.verdict !== "NOT_RUN" && (result.items ?? []).every((item) => !["blocker", "major"].includes(item.severity) || PASSING.has(item.state))

const union = (lists) => [...new Set(lists.flat())]

/** One case's verdict over its trials: PASS only when every trial passed (pass^k), FAIL when any failed. */
export function aggregateVerdict(verdicts) {
  if (verdicts.length && verdicts.every((verdict) => verdict === "PASS")) return "PASS"
  if (verdicts.includes("FAIL")) return "FAIL"
  if (verdicts.includes("BLOCKED")) return "BLOCKED"
  return verdicts[0] ?? "NOT_RUN"
}

/** Groups graded results by case, in first-seen order. */
export function byCase(results) {
  const groups = new Map()
  for (const result of results) {
    if (result.verdict === "NOT_RUN") continue
    if (!groups.has(result.case)) groups.set(result.case, [])
    groups.get(result.case).push(result)
  }
  return groups
}

/** The batch's entry for one case, from all of its trials. A single trial gives the entry it always gave. */
export function caseEntry(runs) {
  const first = runs[0]
  const field = (name) => union(runs.map((run) => run[name] ?? []))
  const entry = {
    case: first.case,
    verdict: aggregateVerdict(runs.map((run) => run.verdict)),
    failed: field("failed"),
    failed_blockers: field("failed_blockers"),
    failed_majors: field("failed_majors"),
    blocked: union(runs.map((run) => [...(run.blocked ?? []), ...(run.blocked_minor ?? [])])),
    findings: field("findings"),
    na: field("na"),
    forbidden_violations: field("forbidden_violations"),
    budget: first.budget,
  }
  if (runs.length > 1 || first.trial) {
    entry.trials = runs.length
    entry.verdicts = runs.map((run) => run.verdict)
    entry.passed_trials = runs.filter((run) => run.verdict === "PASS").length
    entry.strict_trials = runs.filter(strictPass).length
  }
  return entry
}

/** Trials per case, strict pass over runs, and pass^k over cases. */
export function trialStats(results) {
  const groups = [...byCase(results).values()]
  const counts = groups.map((runs) => runs.length)
  const runs = groups.flat()
  const share = (n, d) => (d ? n / d : null)
  return {
    trials: { min: counts.length ? Math.min(...counts) : 0, max: counts.length ? Math.max(...counts) : 0, runs: runs.length },
    strict: { runs: runs.length, passed: runs.filter(strictPass).length, rate: share(runs.filter(strictPass).length, runs.length) },
    pass_k: {
      cases: groups.length,
      // pass^k: the share of cases whose every trial passed, by verdict and by the strict bar.
      verdict: share(groups.filter((g) => g.every((run) => run.verdict === "PASS")).length, groups.length),
      strict: share(groups.filter((g) => g.every(strictPass)).length, groups.length),
    },
  }
}
