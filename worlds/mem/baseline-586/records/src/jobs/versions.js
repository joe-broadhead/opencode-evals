/**
 * A job's versions, their digests, their diffs, and the closed narrowing list
 * a new version is judged against (DESIGN-MEMORY-JOBS §1.2, §5.4).
 *
 * **A draft is a version, not a change.** `jobs` holds the definition that
 * runs; a draft is a `job_versions` row above it, with the version it was made
 * against (`base`) and the diff between them. A run always records the active
 * version and its digest (§1.2), so nothing can run an unapproved version.
 *
 * **Widening is judged by content, never by name.** The consent recorded at
 * confirm stores the job's limits (§5.4); `classifyVersion` compares a version
 * with them. Narrowing — fewer grants, less scope, fewer kinds, a longer
 * interval, smaller budgets, a weaker curate engine — applies at once.
 * Everything else is widening and needs the person's consent again, in a
 * browser (§5.6). This is S2's classifier (`records/src/plugins/classify.js`)
 * redone per job: the same closed list, over the job's own parts.
 */
import { canonicalJSON } from "../plugins/manifest.js"
import { sha256 } from "../ids.js"

/** The parts of a job a version is made of, in the order a diff reads them. */
export const DOC_FIELDS = Object.freeze(["name", "template", "connector", "source", "account", "owner", "scope", "kinds", "grants", "page", "stage", "every_ms", "extract", "transform", "curate", "outputs", "budgets"])

/** The strongest curate engine a version asks for: render is cheaper and writes less (DESIGN §6.1). */
export const ENGINE_RANK = Object.freeze({ render: 0, extract: 1, synthesize: 2 })

const clone = (value) => (value === undefined ? undefined : structuredClone(value))
const same = (a, b) => canonicalJSON(a ?? null) === canonicalJSON(b ?? null)
const grantKey = (grant) => `${grant?.action}\u0000${grant?.resource}`
const sortedKeys = (value) => (value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).sort() : [])

/** The definition columns of a `jobs` row, as a version's doc. */
export function docOfJob(row) {
  if (!row) return null
  const parse = (text, fallback) => {
    try {
      return text === null || text === undefined ? fallback : JSON.parse(text)
    } catch {
      return fallback
    }
  }
  return {
    name: row.name,
    template: row.template,
    connector: row.connector,
    source: row.source,
    account: row.account,
    owner: { id: row.owner_id, label: row.owner_label ?? row.owner_id },
    scope: parse(row.scope, {}),
    kinds: parse(row.kinds, []),
    grants: parse(row.grants, []),
    page: row.page,
    stage: row.stage,
    every_ms: row.every_ms,
    extract: parse(row.extract, []),
    transform: parse(row.transform, {}),
    curate: parse(row.curate, []),
    outputs: parse(row.outputs, []),
    budgets: parse(row.budgets, {}),
  }
}

/**
 * A version's canonical digest. It is taken over every part the person
 * approves **except the account's owner**: an agent drafting a job cannot know
 * who is signed in, so the person's host reports it and the consent records it
 * once (DESIGN §5.2, §5.6). Everything else the run is held to is here.
 */
export function specDigest(doc) {
  const parts = DOC_FIELDS.filter((field) => field !== "owner").map((field) => [field, doc?.[field] ?? null])
  return sha256(canonicalJSON(parts))
}

/** A short, stable shape for a diff row: values as the console shows them. */
function show(value) {
  if (value === undefined || value === null) return null
  if (Array.isArray(value)) return value.map((entry) => (typeof entry === "object" && entry !== null ? clone(entry) : entry))
  if (typeof value === "object") return clone(value)
  return value
}

/**
 * The difference between two versions, as `[{ field, from, to }]`, in
 * `DOC_FIELDS` order. `from` is null for a new job. The diff is data the
 * console renders and the digest is taken over, so the same two versions always
 * produce the same diff.
 */
export function diffOf(base, next) {
  const out = []
  for (const field of DOC_FIELDS) {
    const before = base ? show(base[field]) : null
    const after = show(next?.[field])
    if (!same(before, after)) out.push({ field, from: before, to: after })
  }
  return out
}

/** SHA-256 of the canonical diff: the console's "approve exactly this" binds it. */
export function diffDigest(diff) {
  return sha256(canonicalJSON(Array.isArray(diff) ? diff : []))
}

/** True when a curate stage or a step names a script (DESIGN §2.3, §5.6 `job.script`). */
function hasScript(doc) {
  const stages = Array.isArray(doc?.curate) ? doc.curate : []
  const steps = Array.isArray(doc?.extract) ? doc.extract : []
  return stages.some((stage) => stage && (stage.script !== undefined || stage.engine === "script")) || steps.some((step) => step && step.script !== undefined)
}

/** The limits a consent records (§5.4): what a later version is judged against. */
export function limitsOf(doc) {
  const stages = Array.isArray(doc?.curate) ? doc.curate : []
  const engine = stages.reduce((worst, stage) => ((ENGINE_RANK[stage?.engine] ?? 0) > (ENGINE_RANK[worst] ?? 0) ? stage.engine : worst), "render")
  return {
    connector: doc?.connector ?? null,
    source: doc?.source ?? null,
    account: doc?.account ?? null,
    page: doc?.page ?? null,
    scope: clone(doc?.scope ?? {}),
    kinds: clone(doc?.kinds ?? []),
    grants: clone(doc?.grants ?? []),
    outputs: clone(doc?.outputs ?? []),
    engine,
    stage: stages[0]?.stage ?? null,
    every_ms: Number(doc?.every_ms) || 0,
    max_lines: Math.max(0, ...stages.map((stage) => Number(stage?.maxLines) || 0)),
    budgets: clone(doc?.budgets ?? {}),
    script: hasScript(doc),
  }
}

/** The widest budget of a set: per key, the largest number the person confirmed. */
function budgetCeiling(budgets) {
  const out = {}
  for (const [key, value] of Object.entries(budgets && typeof budgets === "object" ? budgets : {})) {
    if (Number.isFinite(Number(value))) out[key] = Number(value)
  }
  return out
}

/**
 * Judge one version against the limits the person confirmed. Returns the
 * widening (what needs a new consent) and the narrowing (what applies at
 * once). `within` is true when nothing widens.
 *
 * @returns {{ widening: string[], narrowing: string[], within: boolean }}
 */
export function classifyVersion(limits, doc) {
  const widening = []
  const narrowing = []
  if (!limits) return { widening: ["no consent is recorded for this job"], narrowing: [], within: false }
  if (doc?.connector !== limits.connector) widening.push(`the connector changed to ${doc?.connector}`)
  if (doc?.source !== limits.source) widening.push(`the source changed to ${doc?.source}`)
  if (doc?.account !== limits.account) widening.push(`the account changed to ${doc?.account}`)
  if (doc?.page !== limits.page) widening.push(`the page it writes changed to ${doc?.page}`)

  const agreed = new Set((limits.grants ?? []).map(grantKey))
  const asked = new Set((doc?.grants ?? []).map(grantKey))
  const addedGrants = [...asked].filter((key) => !agreed.has(key))
  const droppedGrants = [...agreed].filter((key) => !asked.has(key))
  if (addedGrants.length) widening.push(`grants added: ${addedGrants.map((key) => key.split("\u0000")[0]).join(", ")}`)
  if (droppedGrants.length) narrowing.push(`grants removed: ${droppedGrants.map((key) => key.split("\u0000")[0]).join(", ")}`)

  const scopeKeys = new Set([...sortedKeys(limits.scope), ...sortedKeys(doc?.scope)])
  for (const key of scopeKeys) {
    const was = new Set(Array.isArray(limits.scope?.[key]) ? limits.scope[key] : [])
    const now = new Set(Array.isArray(doc?.scope?.[key]) ? doc.scope[key] : [])
    const added = [...now].filter((id) => !was.has(id))
    const dropped = [...was].filter((id) => !now.has(id))
    if (added.length) widening.push(`${key} added: ${added.slice(0, 3).join(", ")}`)
    if (dropped.length) narrowing.push(`${key} narrowed`)
  }

  const confirmedKinds = new Set(limits.kinds ?? [])
  const kinds = new Set(doc?.kinds ?? [])
  const addedKinds = [...kinds].filter((kind) => !confirmedKinds.has(kind))
  if (addedKinds.length) widening.push(`event kinds added: ${addedKinds.join(", ")}`)
  if ([...confirmedKinds].some((kind) => !kinds.has(kind))) narrowing.push("event kinds narrowed")

  if ((Number(doc?.every_ms) || 0) < (Number(limits.every_ms) || 0)) widening.push("it runs more often")

  const confirmedOutputs = new Set(limits.outputs ?? [])
  const addedOutputs = (doc?.outputs ?? []).filter((output) => !confirmedOutputs.has(output))
  if (addedOutputs.length) widening.push(`outputs added: ${addedOutputs.join(", ")}`)

  const stages = Array.isArray(doc?.curate) ? doc.curate : []
  const engine = stages.reduce((worst, stage) => ((ENGINE_RANK[stage?.engine] ?? 0) > (ENGINE_RANK[worst] ?? 0) ? stage.engine : worst), "render")
  if ((ENGINE_RANK[engine] ?? 0) > (ENGINE_RANK[limits.engine] ?? 0)) widening.push(`the curate engine is stronger (${engine})`)
  const maxLines = Math.max(0, ...stages.map((stage) => Number(stage?.maxLines) || 0))
  if (maxLines > (Number(limits.max_lines) || 0)) widening.push(`it writes more lines (${maxLines})`)
  if (stages.length && limits.stage !== null && stages[0]?.stage !== limits.stage) widening.push("the block it owns changed")

  const ceiling = budgetCeiling(limits.budgets)
  for (const [key, value] of Object.entries(budgetCeiling(doc?.budgets))) {
    if (!(key in ceiling) && value > 0) widening.push(`a new budget: ${key}`)
    else if (key in ceiling && value > ceiling[key]) widening.push(`budget ${key} raised to ${value}`)
  }
  if (hasScript(doc) && !limits.script) widening.push("it has a script step")
  if (limits.script && !hasScript(doc)) narrowing.push("its script step is gone")

  return { widening, narrowing, within: widening.length === 0 }
}
