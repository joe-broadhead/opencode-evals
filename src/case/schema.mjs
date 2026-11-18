// The compiled case: `oc-case/1`. Strict on purpose — a case that cannot be validated is a case that
// would fail differently tomorrow.

export const TIERS = ["T0", "T1", "T2", "T3", "T4"]
export const SEVERITIES = ["blocker", "major", "minor"]
export const GRADERS = ["code", "judge"]
export const AREAS = ["TR", "OC", "PR", "EF", "RL", "SF", "RB", "RT", "CT", "WR", "DT", "ER"]
export const STATUSES = ["active", "retired", "deferred"]
export const BUDGET_KEYS = ["outer_calls", "inner_calls", "billed_calls", "tokens", "cost_usd", "wall_ms", "turns"]

const ID = new RegExp(`^[A-Z]+-(?:${AREAS.join("|")})\\d{2}$`)
/** A case id is a file name and a path segment everywhere it goes: lower-case words joined by dashes. */
export const CASE_ID = /^[a-z0-9][a-z0-9-]{0,119}$/

/**
 * What kind of data a case reads (the `Data:` header). `synthetic`, `seeded` (made by the owner for the round) and `own`
 * (the owner's own data, no third party) may run on any provider; `real` (a third party's words: mail, meetings, CRM notes)
 * and `candidate` (interviews, HR records) never run on an `opencode/*` model, and need the owner's sign-off for Claude.
 */
export const DATA_KINDS = ["synthetic", "seeded", "own", "real", "candidate"]
export const THIRD_PARTY_DATA = ["real", "candidate"]

/**
 * The sets this round reserves (`Set:`), each with the id shape it requires, so an id says what a case is for:
 *   wide   one request per tool, and its paraphrase twin     tools-<tool>[-p]
 *   route  should-not-call (route-no-<n>) and overlap routing (route-<topic>-<n>)    route-<slug>
 *   deep   multi-step tasks, cross-plugin ones with deep-x-  deep-<slug>
 *   commit the write cases that really write to a sandbox    commit-<slug>
 *   hooks  the hook arms' cases                               hook-<slug>
 *   local  the credential-free arm (shell and file tools on): any id, combined with another set
 * Any other lower-case name is the plugin's own (history's `core`, `safety`). `tune`, `holdout`, `tools` and `all` are the
 * families `evals run --set` already knows and cannot be declared.
 */
export const ROUND_SETS = { wide: /^tools-[a-z0-9][a-z0-9-]*$/, route: /^route-[a-z0-9][a-z0-9-]*$/, deep: /^deep-[a-z0-9][a-z0-9-]*$/, commit: /^commit-[a-z0-9][a-z0-9-]*$/, hooks: /^hook-[a-z0-9][a-z0-9-]*$/, local: /./ }
export const FAMILY_SETS = ["tune", "holdout", "tools", "all"]

/** A holdout's id: `hold-<plugin>-<n>-<slug>`. History's earlier `ho-` ids are the one exception. */
export const holdoutId = (plugin) => new RegExp(`^hold-${String(plugin).replace(/[^a-z0-9-]/gi, "")}-\\d+-[a-z0-9][a-z0-9-]*$`)

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
  if (!CASE_ID.test(String(caseObject.id))) bad(`case id ${JSON.stringify(caseObject.id)} must be lower-case words joined by dashes`)
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
  for (const key of caseObject.checkable ?? []) if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) bad(`checkable ${JSON.stringify(key)} must be an argument name`)
  for (const name of caseObject.sets ?? []) {
    if (!/^[a-z][a-z0-9-]*$/.test(name) || FAMILY_SETS.includes(name)) bad(`set ${JSON.stringify(name)} must be a lower-case name, not ${FAMILY_SETS.join(", ")}`)
    if (ROUND_SETS[name] && !ROUND_SETS[name].test(caseObject.id)) bad(`a case in set ${name} has an id like ${String(ROUND_SETS[name].source).replace(/^\^|\$$/g, "").replace(/\[a-z0-9\]\[a-z0-9-\]\*/, "<slug>")}, not ${JSON.stringify(caseObject.id)}`)
  }
  if (caseObject.data !== undefined && !DATA_KINDS.includes(caseObject.data)) bad(`Data must be one of ${DATA_KINDS.join(", ")}, not ${JSON.stringify(caseObject.data)}`)
  if (caseObject.holdout && !holdoutId(caseObject.plugin).test(caseObject.id) && !(caseObject.plugin === "history" && /^ho-/.test(caseObject.id))) bad(`a holdout's id is hold-${caseObject.plugin}-<n>-<slug>, not ${JSON.stringify(caseObject.id)}`)
  for (const claim of caseObject.truth ?? []) if (typeof claim?.path !== "string" || !("value" in claim)) bad("a truth is {path, value}")
  if (caseObject.status !== undefined && !STATUSES.includes(caseObject.status)) bad(`status must be one of ${STATUSES.join(", ")}`)
  return caseObject
}
