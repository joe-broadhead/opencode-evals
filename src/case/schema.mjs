import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
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
 * The corpora written before the `Data:` header and the round sets existed (history, x, charts, and p0, the harness's own probes): a case of one of them that declares
 * no round set is a legacy case, and its data is what the corpus always held: history reads the owner's own sessions, x reads other
 * people's public posts (so `real`: nothing a third party wrote goes to a model without the owner's sign-off), charts draws made-up data.
 * Every other case, and every legacy-plugin case in a round set, must declare `Data:` and a round set.
 */
export const LEGACY_DATA = Object.freeze({ history: "own", x: "real", charts: "synthetic", p0: "synthetic" })

/**
 * The least a plugin's cases may declare, because of what the plugin reads: other people's words (meetings, recordings, CRM notes) are
 * `real`, HR records are `candidate`. A case's own label is the writer's word, so the minimum is derived: the highest over the case's
 * plugin and every plugin its `Seed: plugins=` names (G0 re-check 3.1). Slack, gws and the other plugins whose reads can be sandbox-only
 * have none: their cases say `seeded` or `synthetic` when the data is the owner's own sandbox.
 */
export const DATA_MINIMUM = Object.freeze({ metaview: "candidate", ashby: "candidate", granola: "real", wisprflow: "real", plaud: "real", affinity: "real" })

/** The plugins a `Seed:` line names (`plugins=a,b`, with the spaces `Seed: plugins=a, b files=x` allows). */
export function seedPlugins(seed) {
  const m = /(?:^|\s)plugins=([^=]*?)(?=\s+[A-Za-z][A-Za-z0-9_-]*=|$)/.exec(String(seed ?? ""))
  return m ? m[1].split(/[\s,]+/).filter(Boolean) : []
}

/** The lowest `Data:` a case may declare, and the plugin that sets it: `{ kind, plugin }` or null. */
export function dataMinimum(caseObject) {
  let best = null
  for (const plugin of [caseObject.plugin, ...seedPlugins(caseObject.seed)]) {
    const kind = DATA_MINIMUM[plugin]
    if (kind && (!best || DATA_KINDS.indexOf(kind) > DATA_KINDS.indexOf(best.kind))) best = { kind, plugin }
  }
  return best
}

/** The plugins this repository holds a pack for: the round's own corpora (a fixture plugin of a test has none). */
const PACKS_DIR = join(import.meta.dirname, "..", "..", "packs")
export const packPlugins = () => new Set(existsSync(PACKS_DIR) ? readdirSync(PACKS_DIR) : [])

export const isLegacyCase = (caseObject) => caseObject.plugin in LEGACY_DATA && !(caseObject.sets ?? []).some((name) => name in ROUND_SETS)

/** What a case reads: its `Data:`, else what a legacy corpus always held, else (never reached: compile refuses it) `real`. */
export const dataOf = (caseObject) => {
  const declared = caseObject.data ?? LEGACY_DATA[caseObject.plugin] ?? "real"
  // Never below what the plugins a case uses read, whatever its label says (defence in depth: compile refuses the case first).
  const minimum = dataMinimum(caseObject)
  return minimum && DATA_KINDS.indexOf(declared) < DATA_KINDS.indexOf(minimum.kind) ? minimum.kind : declared
}

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
  for (const name of caseObject.home_files ?? []) if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(name) || name.split("/").some((part) => part === "." || part === ".." || part.startsWith("."))) bad(`Home files ${JSON.stringify(name)} must be a path of visible names under the home (no .., no leading /, and no name that starts with a dot: .local/share/opencode holds the host's log and database)`)
  // A canary the prompt fills and an item grades is satisfied by echoing the question.
  const filled = new Set([...String(caseObject.prompt ?? "").matchAll(/\{\{canary:([A-Za-z0-9_.-]+)\}\}/g)].map((m) => m[1]))
  for (const item of caseObject.items ?? []) {
    for (const clause of [...(item.evidence ?? []), ...(item.evidence_any ?? []).flat(), ...(item.na_when ?? [])]) {
      if (clause?.kind === "canary" && filled.has(clause.name)) bad(`${item.id}: the prompt fills {{canary:${clause.name}}} and this item grades @canary.${clause.name}: an answer that echoes the question passes. Grade a canary the prompt does not carry`)
    }
  }
  if (caseObject.data === undefined && !isLegacyCase(caseObject)) bad(`Data is required (one of ${DATA_KINDS.join(", ")}): it says whose words the case reads, and a case that omits it would be taken for synthetic. Add \`- Data: ...\` to the header`)
  if (!isLegacyCase(caseObject) && packPlugins().has(caseObject.plugin) && !(caseObject.sets ?? []).some((name) => name in ROUND_SETS)) bad(`a case declares one of this round's sets (${Object.keys(ROUND_SETS).join(", ")}): \`- Set: ...\`; only the history, x and charts corpora written before it are exempt`)
  const minimum = caseObject.data !== undefined ? dataMinimum(caseObject) : null
  if (minimum && DATA_KINDS.indexOf(caseObject.data) < DATA_KINDS.indexOf(minimum.kind)) bad(`a case that uses ${minimum.plugin}${minimum.plugin === caseObject.plugin ? "" : " (Seed: plugins=)"} reads ${minimum.kind} data${minimum.kind === "candidate" ? " (HR records)" : " (other people's words)"}, not ${caseObject.data}: declare \`- Data: ${minimum.kind}\` (or higher)`)
  if (caseObject.data !== undefined && !DATA_KINDS.includes(caseObject.data)) bad(`Data must be one of ${DATA_KINDS.join(", ")}, not ${JSON.stringify(caseObject.data)}`)
  if (caseObject.holdout && !holdoutId(caseObject.plugin).test(caseObject.id) && !(caseObject.plugin === "history" && /^ho-/.test(caseObject.id))) bad(`a holdout's id is hold-${caseObject.plugin}-<n>-<slug>, not ${JSON.stringify(caseObject.id)}`)
  for (const claim of caseObject.truth ?? []) if (typeof claim?.path !== "string" || !("value" in claim)) bad("a truth is {path, value}")
  if (caseObject.status !== undefined && !STATUSES.includes(caseObject.status)) bad(`status must be one of ${STATUSES.join(", ")}`)
  return caseObject
}
