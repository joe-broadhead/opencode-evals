/** Offline server-only planning. No plan is a grant, lease or readable verdict. */
import { descriptorHash } from "./manifest.js"
import { scopeProblems } from "../vendor/source-contract/events.js"

function freeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze)
    Object.freeze(value)
  }
  return value
}
const result = (reason, items = []) => freeze({ kind: "collection-projection-plan", active: false, reason, items })
const id = (value) => typeof value === "string" && /^[a-zA-Z0-9._:-]{1,128}$/.test(value)
const finite = (value) => Number.isSafeInteger(value) && value >= 0
const positive = (value) => finite(value) && value > 0
const hash = descriptorHash
const record = (v) => v && typeof v === "object" && !Array.isArray(v)
const only = (v, keys) => Object.keys(v).every((key) => keys.includes(key))
function canonicalScope(scope, keys) {
  if (!record(scope) || scopeProblems(scope, keys).length) return null
  const entries = []
  for (const [key, value] of Object.entries(scope)) {
    // The source contract permits a scalar ID or an ID list, never characters.
    const values = typeof value === "string" ? [value] : value
    if (!values.length || values.some((id) => !id.trim())) return null
    entries.push([key, [...new Set(values)].sort()])
  }
  return Object.fromEntries(entries)
}

// Detached bounded data only: never invoke accessors/toJSON or retain input DTOs.
function data(value, maxBytes = 262144) {
  let nodes = 0, bytes = 0
  const seen = new Set()
  function copy(v, depth = 0) {
    if (++nodes > 8192 || depth > 12) throw new Error("data_limit")
    if (v === undefined || v === null || typeof v === "boolean") return v
    if (typeof v === "number") return v // Numeric limits below reject nonfinite values.
    if (typeof v === "string") {
      bytes += v.length
      if (bytes > maxBytes) throw new Error("data_limit")
      return v
    }
    if (!v || typeof v !== "object" || seen.has(v)) throw new Error("invalid_data")
    const array = Array.isArray(v)
    if (!(array ? Object.getPrototypeOf(v) === Array.prototype : [Object.prototype, null].includes(Object.getPrototypeOf(v)))) throw new Error("invalid_data")
    const keys = Reflect.ownKeys(v)
    if (keys.length > 128) throw new Error("data_limit")
    seen.add(v)
    const output = array ? [] : Object.create(null)
    for (const key of keys) {
      if (typeof key !== "string") throw new Error("invalid_data")
      const d = Object.getOwnPropertyDescriptor(v, key)
      if (!d || !("value" in d)) throw new Error("invalid_data")
      if (array && key === "length") continue
      if (array && !/^(0|[1-9]\d*)$/.test(key)) throw new Error("invalid_data")
      bytes += key.length
      if (bytes > maxBytes) throw new Error("data_limit")
      output[key] = copy(d.value, depth + 1)
    }
    if (array && (output.length !== v.length || Object.keys(output).length !== v.length)) throw new Error("invalid_data")
    seen.delete(v)
    return output
  }
  return copy(value)
}
const numbers = (v, keys) => record(v) && keys.every((key) => finite(v[key])) && Object.keys(v).length === keys.length
const retentionKeys = ["textDays", "metadataDays", "derivedDays", "cacheDays"]
const accountKeys = ["source", "provider", "account", "tenant"]
function knownLimits(v) {
  return v && numbers(v.retention, retentionKeys) && finite(v.historyDays) && positive(v.cadenceSeconds) &&
    numbers(v.provider, ["maxCalls", "maxCostMicros"]) && numbers(v.model, ["maxCalls", "maxTokens", "maxCostMicros"])
}
function knownTerms(t) {
  return knownLimits(t) && only(t, ["coverage", "purpose", "audience", "retention", "extendedMetadata", "historyDays", "cadenceSeconds", "scope", "wholeSource", "privateFields", "provider", "model", "probe", "exclusions"]) &&
    t.coverage === "current-and-future-conforming" && t.purpose === "personal-memory" && t.audience === "personal" &&
    t.retention.textDays <= 30 && t.historyDays <= 30 && typeof t.extendedMetadata === "boolean" &&
    (t.retention.metadataDays <= t.retention.textDays || t.extendedMetadata) && typeof t.privateFields === "boolean" &&
    typeof t.wholeSource === "boolean" && record(t.scope) && Array.isArray(t.exclusions) && t.exclusions.length <= 64 &&
    t.exclusions.every((e) => record(e) && only(e, accountKeys) && accountKeys.every((key) => id(e[key]))) &&
    (t.probe === undefined || (record(t.probe) && only(t.probe, ["maxCalls", "maxCostMicros", "allowUnknownBilling", "expiresAt"]) &&
      finite(t.probe.maxCalls) && finite(t.probe.maxCostMicros) && finite(t.probe.expiresAt) && typeof t.probe.allowUnknownBilling === "boolean"))
}

function accepted(p, c) {
  const a = p?.acceptance
  return p?.state === "accepted" && p.version === 1 && positive(p.generation) && p.principal === c.principal && p.space === c.space &&
    finite(p.expiresAt) && p.expiresAt > c.nowMs && a?.state === "stored" && ["browser-session", "verified-host-action"].includes(a.via) && id(a.receipt) &&
    a.version === p.version && a.generation === p.generation && a.digest === p.digest && p.digest === hash({ version: p.version, terms: p.terms })
}

function limitsOf(terms, semantics, item) {
  const minima = (a, b) => Object.fromEntries(Object.keys(a).map((key) => [key, Math.min(a[key], b[key])]))
  const retention = minima(terms.retention, semantics.retention)
  if (positive(item.retentionDays)) for (const key of retentionKeys) retention[key] = Math.min(retention[key], item.retentionDays)
  return { retention, historyDays: Math.min(terms.historyDays, semantics.historyDays),
    cadenceSeconds: Math.max(terms.cadenceSeconds, semantics.cadenceSeconds),
    provider: minima(terms.provider, semantics.provider), model: minima(terms.model, semantics.model) }
}

function scopeCovered(scope, terms, entry, item) {
  const keys = item.scope?.keys ?? []
  const requested = canonicalScope(scope, keys)
  const envelope = canonicalScope(terms.scope, keys)
  const stored = canonicalScope(entry.restriction, keys)
  if (!requested || !envelope || !stored) return null
  for (const restriction of [envelope, stored]) {
    for (const [key, ids] of Object.entries(restriction)) {
      if (!Object.hasOwn(requested, key) || requested[key].some((id) => !ids.includes(id))) return null
    }
  }
  if (!terms.wholeSource && (!Object.keys(envelope).length || Object.keys(requested).some((key) => !Object.hasOwn(envelope, key)))) return null
  return requested
}

function probePlan(entry, c, terms) {
  const a = terms.probe, probe = entry.probe
  if (probe?.minimalIdentityOnly !== true || !positive(a?.maxCalls) || !finite(a.maxCostMicros) || !finite(a.expiresAt) || !(a.expiresAt > c.nowMs)) return null
  if (probe.cost === "unknown") {
    if (a.allowUnknownBilling !== true || !positive(a.maxCostMicros)) return null
  } else if (!["free", "paid"].includes(probe.cost) || !finite(probe.maxCostMicros) || probe.maxCostMicros > a.maxCostMicros) return null
  return { maxCalls: a.maxCalls, maxCostMicros: a.maxCostMicros, expiresAt: Math.min(a.expiresAt, c.policyExpiry) }
}

async function planEntry(entry, c, p, readers) {
  const base = { candidate: hash([entry.source, entry.provider, entry.account, entry.tenant]), policyGeneration: p.generation }
  const stop = (reason, state = "attention") => ({ ...base, state, phase: "NONE", reason })
  if (![entry.source, entry.provider, entry.account, entry.tenant].every(id)) return stop("stable_account_required")
  const suppression = data(await readers.readSuppression(c, { principal: c.principal, space: c.space, source: entry.source, provider: entry.provider, account: entry.account, tenant: entry.tenant }))
  if (["excluded", "paused", "unbound", "revoked"].includes(suppression?.state)) return stop(`suppressed_${suppression.state}`, "excluded")
  if (suppression?.state !== "none") return stop("suppression_unknown")
  if (p.terms.exclusions.some((e) => accountKeys.every((key) => e[key] === entry[key]))) return stop("policy_excluded", "excluded")
  if (entry.consentOrigin === "legacy") return stop("legacy_unchanged", "excluded")
  if (entry.authenticated !== true) return stop("authentication_required")
  if (entry.installed?.ok !== true || entry.installed.hash !== hash(entry.installed.descriptor)) return stop("installed_declaration_required", "refused")
  const item = entry.installed?.descriptor?.items?.find((item) => item.id === entry.source)
  if (item?.kind !== "events") return stop("unsupported_event_source", "refused")
  if (entry.codeApproved !== true) return stop("host_code_approval_required")
  const s = entry.semantics, t = p.terms
  if (!s || !only(s, ["digest", "state", "purpose", "audience", "privateFields", "retention", "historyDays", "cadenceSeconds", "provider", "model"]) || s.state !== "known" || s.digest !== entry.installed?.hash) return stop("semantics_unknown")
  if (s.purpose !== t.purpose || s.audience !== t.audience) return stop("purpose_attention")
  if (typeof s.privateFields !== "boolean" || ((s.privateFields || item?.private) && !t.privateFields)) return stop("private_fields_attention")
  if (!knownLimits(s)) return stop("limits_unknown")
  const scope = scopeCovered(entry.scope, t, entry, item)
  if (!scope) return stop("scope_attention")
  const link = data(await readers.readAccountLink(c, entry))
  if (link?.state === "denied") return stop("account_relation_denied", "refused")
  if (!["control", "delegation"].includes(link?.state) || !id(link.subject) || !id(link.evidence)) {
    const probe = link?.state === "unknown" ? probePlan(entry, { ...c, policyExpiry: p.expiresAt }, t) : null
    return probe ? { ...base, state: "candidate", phase: "PROBE_ONLY", reason: "pending_identity_probe", probe } : stop("account_relation_attention")
  }
  if (link.principal !== c.principal || ["provider", "account", "tenant"].some((key) => link[key] !== entry[key])) return stop("account_relation_mismatch", "refused")
  if (item?.cost?.class !== "free") return stop("provider_cost_attention")
  const previous = entry.previous
  if (previous) {
    if (["provider", "account", "tenant"].some((key) => previous[key] !== entry[key]) || previous.subject !== link.subject || previous.scopeDigest !== hash(scope) || previous.purpose !== t.purpose) return stop("partition_change_attention")
    if (previous.digest !== entry.installed.hash) {
      const verdict = data(await readers.readCompatibility?.(c, { source: entry.source, fromDigest: previous.digest, toDigest: entry.installed.hash }))
      if (verdict?.state !== "reviewed-equivalent" || verdict.fromDigest !== previous.digest || verdict.toDigest !== entry.installed.hash || !id(verdict.review)) return stop("semantic_update_attention")
    }
  }
  const local = c.runtime === "local"
  if (entry.localHistory && (!local || !id(c.origin))) return stop("local_origin_required")
  return { ...base, state: "candidate", phase: local ? "NEEDS_LOCAL_PROJECTION" : "NEEDS_HOST_PROJECTION", reason: local ? "pending_local_projection" : "pending_host_projection",
    partition: hash([c.principal, c.space, entry.source, entry.provider, entry.account, entry.tenant, scope, t.purpose, entry.localHistory ? c.origin : null]),
    limits: limitsOf(t, s, item) }
}

/**
 * Internal proposed interface, not a public/persisted contract.
 * @param {object} readers Trusted server composition, NEVER request dependencies.
 * @param {function(): object|Promise<object>} readers.readContext Authenticated personal principal/space/runtime/time.
 * @param {function(object): object|Promise<object>} readers.readPolicy Current stored acceptance and terms.
 * @param {function(object, {limit:number}): Array|Promise<Array>} readers.readInventory Actual disk-validated installed account candidates.
 * @param {function(object, object): object|Promise<object>} readers.readSuppression Durable stable-ID suppression lookup.
 * @param {function(object, object): object|Promise<object>} readers.readAccountLink Explicit server control/delegation evidence.
 * @param {function(object, object): object|Promise<object>} [readers.readCompatibility] Reviewed digest-pair equivalence only.
 * @returns {function({sources?: string[]}=): Promise<object>} Plan only, no authority token or side effects.
 * Readers must be read-only, bounded and credential-free. DTO shapes and trust
 * obligations are in docs/design/collection-policy-planner.md. No writer exists.
 */
export function createCollectionPolicyPlanner(readers) {
  const { readContext, readPolicy, readInventory } = readers
  return async function plan(request = {}) {
    try { request = data(request, 8192) } catch { return result("invalid_request") }
    if (!record(request) || !only(request, ["sources"]) || (Object.hasOwn(request, "sources") && (!Array.isArray(request.sources) || request.sources.length > 64 || !request.sources.every(id)))) return result("invalid_request")
    try {
      const context = data(await readContext())
      if (context?.personal !== true || !id(context.principal) || !id(context.space) || !finite(context.nowMs)) return result("personal_context_required")
      const policy = data(await readPolicy(context))
      if (!policy) return result("policy_required")
      if (!accepted(policy, context)) return result("acceptance_required")
      if (!knownTerms(policy.terms)) return result("policy_terms_attention")
      if (!["jelly", "local"].includes(context.runtime)) return result("source_runtime_absent")
      if (context.runtime === "local" && context.localAdapter !== "existing-source-session") return result("local_adapter_required")
      const inventory = data(await readInventory(context, { limit: 64 }))
      if (!Array.isArray(inventory) || inventory.length > 64) return result("inventory_limit")
      const items = []
      for (const entry of inventory) {
        if (request.sources && !request.sources.includes(entry.source)) continue
        items.push(await planEntry(entry, context, policy, readers))
      }
      return result("planned", items)
    } catch { return result("trusted_state_unavailable") }
  }
}
