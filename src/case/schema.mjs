// The compiled case: `oc-case/1`. Strict on purpose — a case that cannot be validated is a case that
// would fail differently tomorrow.

export const TIERS = ["T0", "T1", "T2", "T3", "T4"]
export const SEVERITIES = ["blocker", "major", "minor"]
export const GRADERS = ["code", "judge"]
export const AREAS = ["TR", "OC", "PR", "EF", "RL", "SF", "RB"]
export const BUDGET_KEYS = ["outer_calls", "inner_calls", "billed_calls", "tokens", "cost_usd", "wall_ms", "turns"]

const ID = /^[A-Z]+-(?:TR|OC|PR|EF|RL|SF|RB)\d{2}$/

export class CaseError extends Error {
  constructor(file, message, line) {
    super(`${file}${line ? `:${line}` : ""}: ${message}`)
    this.name = "CaseError"
    this.file = file
    this.line = line
  }
}

/** Validates one compiled case and returns it unchanged, or throws the first problem. */
export function validateCase(caseObject, file = "<case>") {
  const bad = (message, line) => {
    throw new CaseError(file, message, line)
  }
  if (!caseObject || typeof caseObject !== "object") bad("not an object")
  if (caseObject.schema !== "oc-case/1") bad(`schema must be "oc-case/1", got ${JSON.stringify(caseObject.schema)}`)
  for (const key of ["id", "plugin", "skill", "tier", "prompt", "items"]) {
    if (caseObject[key] === undefined || caseObject[key] === null || caseObject[key] === "") bad(`missing ${key}`)
  }
  if (!TIERS.includes(caseObject.tier)) bad(`tier must be one of ${TIERS.join(", ")}`)
  if (!Array.isArray(caseObject.items) || caseObject.items.length === 0) bad("a case needs at least one item")
  const seen = new Set()
  for (const item of caseObject.items) {
    if (!ID.test(item.id ?? "")) bad(`item id ${JSON.stringify(item.id)} must look like X-PR01`)
    if (seen.has(item.id)) bad(`duplicate item id ${item.id}`)
    seen.add(item.id)
    if (!SEVERITIES.includes(item.severity)) bad(`${item.id}: severity must be one of ${SEVERITIES.join(", ")}`)
    if (!item.ask || item.ask.length < 8) bad(`${item.id}: an item needs a falsifiable ask`)
    if (!GRADERS.includes(item.grader)) bad(`${item.id}: grader must be code or judge`)
    if (!Array.isArray(item.evidence)) bad(`${item.id}: evidence must be an array`)
    if (!Array.isArray(item.evidence_any ?? [])) bad(`${item.id}: evidence_any must be an array`)
    if (item.grader === "code" && (item.evidence.length === 0 && (item.evidence_any ?? []).length === 0)) {
      bad(`${item.id}: a code item needs at least one evidence clause`)
    }
    if (item.severity === "blocker" && item.grader === "judge") {
      bad(`${item.id}: a judge item cannot be a blocker (D2: no judge blocks a release until it is calibrated)`)
    }
    for (const mapping of item.maps_to ?? []) {
      if (!/^[AF]\d+$/.test(mapping)) bad(`${item.id}: maps_to ${JSON.stringify(mapping)} must be A1 or F2`)
    }
  }
  for (const budget of Object.keys(caseObject.budgets ?? {})) {
    if (!BUDGET_KEYS.includes(budget)) bad(`unknown budget ${budget}; known: ${BUDGET_KEYS.join(", ")}`)
    const value = caseObject.budgets[budget]
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) bad(`budget ${budget} must be a non-negative number`)
  }
  if (caseObject.expect && !["pass", "fail", "na"].includes(caseObject.expect)) bad("expect must be pass, fail or na")
  return caseObject
}
