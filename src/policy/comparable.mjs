// Comparability: two results may be compared only if every axis but the one under test matches.
//
// This is where the nx3r–nx5 lesson is enforced mechanically. The recorded runs predate provenance, so
// their case set and skill tree are `unrecorded`: a comparison between them is refused, not silently
// scored. `basis: "declared"` is the explicit override, and it is printed in the verdict.

export const AXES = ["skill", "description", "namespace", "tools", "rules", "cases", "model", "host"]

const fieldOf = (batch, axis) => {
  const p = batch?.provenance ?? {}
  switch (axis) {
    case "skill":
      return p.skills
    case "description":
      return p.descriptions
    case "namespace":
      return p.namespace
    case "tools":
      return p.tools
    case "rules":
      return p.rules
    case "cases":
      return p.cases
    case "model":
      return p.model
    case "host":
      return p.opencode
    default:
      return p[axis] ?? null
  }
}

const scalar = (field) => {
  if (field === null || field === undefined) return null
  if (typeof field === "object") return field.sha256 ?? field.value ?? null
  return field
}

const recorded = (field) => Boolean(field) && field.source !== "unrecorded" && scalar(field) !== null

/**
 * @returns {{ok: boolean, axis: string, basis: "verified"|"declared"|"refused", why: string[]}}
 */
export function comparable(a, b, axis = "skill", { assume = "refuse" } = {}) {
  const why = []
  const unverified = []

  // The axis under test must be identifiable on both sides, or nothing can be attributed to it.
  for (const [label, batch] of [["a", a], ["b", b]]) {
    const field = fieldOf(batch, axis)
    if (!recorded(field)) unverified.push(`${label}: ${axis} is ${field?.source ?? "not recorded"}`)
  }

  // Every other axis must be verified and equal.
  for (const other of AXES) {
    if (other === axis) continue
    const x = fieldOf(a, other)
    const y = fieldOf(b, other)
    if (!recorded(x) || !recorded(y)) {
      unverified.push(`${other} is not recorded on ${!recorded(x) ? "a" : "b"}`)
      continue
    }
    if (String(scalar(x)) !== String(scalar(y))) why.push(`${other} differs: ${String(scalar(x)).slice(0, 12)} vs ${String(scalar(y)).slice(0, 12)}`)
  }

  // A rule change is a case-set change: the cases encode a rule, and a different rule is different cases.
  const ruleA = fieldOf(a, "cases")?.rule_set ?? null
  const ruleB = fieldOf(b, "cases")?.rule_set ?? null
  if (ruleA && ruleB && ruleA !== ruleB) why.push(`the rule set the cases encode changed: ${ruleA} vs ${ruleB}`)

  // A grader comparison is about the same recordings, not the same case set.
  if (axis === "grader" && a.recordings_sha256 && b.recordings_sha256 && a.recordings_sha256 !== b.recordings_sha256) {
    why.push("the recordings differ, so this is not a re-grade")
  }

  const unverifiedCases = unverified.some((w) => w.startsWith("cases") || w.includes(" cases "))
  if (unverifiedCases) {
    why.push("the case set the runs used is not recorded; a case edited mid-comparison (nx3r–nx5) is exactly this failure")
  }
  const all = [...why, ...unverified]
  if (all.length === 0) return { ok: true, axis, basis: "verified", why: [] }
  // `declared` is the explicit "I know this is not verified, show me the numbers anyway" switch. It is
  // recorded in the verdict and `decide` will never ship on it.
  if (assume === "declared") return { ok: true, axis, basis: "declared", why: [`declared, not verified: ${all.join("; ")}`] }
  return { ok: false, axis, basis: "refused", why: all }
}
