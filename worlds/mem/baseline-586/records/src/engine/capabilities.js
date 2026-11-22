/** D1: Memory-owned capability projection. This adapter never grants permission. */
import { descriptorHash } from "../plugins/manifest.js"
import { checkIngest } from "../plugins/consent.js"
import { eventProblems, scopeProblems } from "../vendor/source-contract/events.js"
import { sha256 } from "../ids.js"
import { isSelfActor } from "../routines/passes.js"

const verdicts = new WeakMap()
const digest = descriptorHash
const line = (value, max = 300) => typeof value === "string" && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value)
const instant = (value) => line(value, 40) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value) && Number.isFinite(Date.parse(value))
const parse = (value) => { try { return JSON.parse(value) } catch { return null } }
const clone = (value) => JSON.parse(JSON.stringify(value))
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

// Bound work before invoking the shared validators. No schema is copied here.
function bounded(value, budget = 400_000) {
  let nodes = 0, bytes = 0
  const seen = new Set()
  function visit(item, depth) {
    if (++nodes > 8_000 || depth > 12) throw new Error("input_limit")
    if (item === null || typeof item === "boolean") return
    if (typeof item === "number" && Number.isFinite(item)) return
    if (typeof item === "string") {
      bytes += item.length
      if (bytes > budget) throw new Error("input_limit")
      return
    }
    if (!item || typeof item !== "object" || seen.has(item) || (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))) throw new Error("invalid_input")
    seen.add(item)
    const keys = Object.keys(item)
    if (keys.length > 512) throw new Error("input_limit")
    for (const key of keys) {
      const property = Object.getOwnPropertyDescriptor(item, key)
      if (!property || !("value" in property)) throw new Error("invalid_input")
      bytes += key.length
      if (property.value !== undefined) visit(property.value, depth + 1)
    }
    seen.delete(item)
  }
  visit(value, 0)
}
const bindingIdentity = (row) => ({ source: row.source, account: row.account, owner: row.owner_id, status: row.status, enabled: row.enabled, confirmedAt: row.confirmed_at ?? null, updated: row.updated ?? null })
function token(value) {
  const result = Object.freeze({})
  verdicts.set(result, freeze(value))
  return result
}

/**
 * Server-only, synchronous read adapter; call inside the already-authorized
 * records transaction. `handle` is its database handle, `binding` a sources row,
 * `descriptor` the validated installed sources value (not an RPC declaration).
 * `context` comes from Memory/gateway: tenant, space, grants, consentGroup,
 * policyEpoch, lane; optional `person` is the existing server identity checker.
 * Optional purpose:"recruiting" is a server restriction, NOT an event tag or
 * a purpose declaration/consent. Unknown purpose requires D3's policy checks.
 * Reuses checkIngest, never takes an `allowed` boolean. Returns an opaque,
 * event-bound in-process verdict, not serializable permission or a grant.
 * Recheck after any authorization change; do not persist/reuse across requests.
 * Restricted pages must explicitly echo every stored consent restriction as a
 * nonempty permitted subset. Omitted keys never become whole-source defaults.
 * A verdict is only a request-local snapshot: D2/D3 must reauthorize at their
 * transaction's commit gate and fence the manifest's policy epoch there.
 */
export function authorizeCapabilities({ handle, event, descriptor, binding, context, scope, now } = {}) {
  const deny = (reason) => token({ reason })
  try {
    bounded(event)
    bounded(descriptor)
    bounded(scope ?? {}, 16_000)
    if (!instant(now)) return deny("invalid_now")
    if (eventProblems(event).length) return deny("unsupported_event")
    if (!binding || !line(binding.source, 64) || !line(binding.account, 128)) return deny("binding_required")
    const actual = handle.get("select * from sources where source = ? and account = ?", binding.source, binding.account)
    if (!actual || actual.status !== "confirmed" || actual.enabled !== 1 || digest(bindingIdentity(actual)) !== digest(bindingIdentity(binding))) return deny("binding_unconfirmed")
    const consent = handle.get("select * from plugin_consents where source = ? and account = ?", binding.source, binding.account)
    if (!consent || consent.state !== "on") return deny("consent_unavailable")
    const plugin = handle.get("select * from plugins where plugin_id = ?", consent.plugin_id)
    const installed = parse(plugin?.manifest_json)
    if (plugin?.state !== "available" || installed?.contract !== "sources" || digest(installed.descriptor) !== digest(descriptor) || plugin.digest !== digest(descriptor) || (consent.live_digest ?? consent.digest) !== digest(descriptor) || consent.package_name !== plugin.package_name || consent.source_kind !== plugin.source_kind || consent.source_ref !== plugin.source_ref) return deny("declaration_changed")
    const item = descriptor.items.find((entry) => entry.id === binding.source)
    if (!item || item.kind !== "events" || item.reads !== event.kind) return deny("unsupported_kind")
    if (scopeProblems(scope ?? {}, item.scope?.keys ?? []).length) return deny("unsupported_scope")
    // checkIngest checks provided entries, not completeness. Consult the actual
    // server consent, never descriptor defaults, before accepting a scoped page.
    const confirmed = parse(consent.scope_json)
    bounded(confirmed, 16_000)
    if (scopeProblems(confirmed, item.scope?.keys ?? []).length) return deny("confirmed_scope_invalid")
    if (Object.entries(confirmed).some(([key, ids]) => !ids.length || !Array.isArray(scope?.[key]) || !scope[key].length || scope[key].some((id) => !ids.includes(id)))) return deny("scope_not_confirmed")
    if (event.source !== (item.input?.source ?? item.id) || event.account !== binding.account) return deny("identity_mismatch")
    const checked = checkIngest(handle, { source: binding.source, account: binding.account, owner: { id: binding.owner_id }, scope }, [event])
    if (checked.events.length !== 1 || checked.events[0] !== event || checked.refusals.length) return deny("consent_unavailable")
    if (!context || ["tenant", "space", "consentGroup", "policyEpoch"].some((key) => !line(context[key])) || !["own", "general", "backfill"].includes(context.lane)) return deny("authorization_context_required")
    if (!Array.isArray(context.grants) || context.grants.length > 128) return deny("authorization_context_required")
    bounded(context.grants, 16_000)
    const partition = { tenant: context.tenant, space: context.space, source: binding.source, account: binding.account, scope: digest(scope ?? {}), grants: digest(context.grants), consent: digest(consent), consentGroup: context.consentGroup, policyEpoch: context.policyEpoch, lane: context.lane }
    const pluginDigest = digest({ package: plugin.package_name, version: plugin.version, declaration: digest(descriptor) })
    const self = event.actors.filter((entry) => !["bot", "agent", "service"].includes(entry.kind) && isSelfActor(context.person, entry.id, binding, entry.self)).map((entry) => entry.id)
    return token({ now, event: digest(event), descriptor: digest(descriptor), binding: digest(bindingIdentity(binding)), partition, pluginDigest, self, recruiting: context.purpose === "recruiting", item: clone(item) })
  } catch {
    return deny("authorization_refused")
  }
}

const denied = (reason) => freeze({ version: 1, readable: false, ready: false, available: [], eligible: [], reasons: [reason], identity: null, partition: null, revision: null, fingerprint: null, proposed: null })

/**
 * @typedef {object} EvidencePart
 * @property {string} id Opaque stable source-part id, or a snapshot-local id.
 * @property {"body"|"block"|"turn"|"transcript"} role
 * @property {string} text Bounded evidence, never structural metadata.
 * @property {{id:string, kind:string, self:boolean}} actor Names are omitted.
 * @property {string} hash SHA-256 of this exact part's text.
 * @property {boolean} stable Source declares stable parts; D2 must verify history.
 * @property {null} expiresAt D1 has no trusted first-observation anchor.
 *
 * @typedef {object} CapabilityProjection
 * @property {1} version
 * @property {boolean} readable Consent/binding accepted, NOT extraction permission.
 * @property {false} ready D1 alone is never ready for execution.
 * @property {string[]} available Actual bounded_text, stable_parts, typed_state.
 * @property {string[]} eligible Always empty until D2/D3 validate evidence/policy.
 * @property {string[]} reasons Closed Memory-owned codes, never plugin error text.
 * @property {object|null} identity Exact source/wireSource/account/externalId tuple.
 * @property {object|null} partition D0 authorization partition, with digests.
 * @property {object|null} revision Content equality tokens, order:"unknown".
 * @property {string|null} fingerprint Projection/authorization digest, not a grant.
 * @property {object|null} proposed D0-shaped proposal with EvidencePart[]; not a manifest input yet.
 * @property {object[]} [evidence] Text-free part metadata with unresolved/server self attribution.
 * @property {object[]} [sourceFacts] Minimized same-source state/response assertions, not truth.
 * @property {string} [pluginDigest] Installed package, version and declaration digest.
 * @property {"events"} [sourceKind]
 * @property {"partial"|"unavailable"} [segmentation] No v0.3 quote/signature segmentation exists.
 */

/**
 * Pure D1 seam. Inputs are the original validated v0.3 wire event, installed
 * descriptor, server binding and opaque authorizeCapabilities verdict, plus
 * the same explicit UTC `now`. No I/O, model, hydration, or permission change.
 * Output is a deeply frozen JSON DTO, detached from caller objects.
 * `available` describes fields, never eligibility. D2 must anchor evidence;
 * revision tokens are content equality only, never lexical/time ordering.
 *
 * D0 projection: D2 takes proposed's ref/externalId/revision/partition/kind,
 * participants and optional state/domains/textConsent, then projects each part to
 * {id,role,text,actor,expiresAt:<trusted D2 anchor expiry>}. Drop hash/stable;
 * brickManifest recomputes hashes. Never use occurred_at, now or updated as
 * an evidence anchor. Parts with expiresAt:null MUST NOT enter D0. Preserve
 * earlier anchors across unchanged/reimported text, even under a new part id.
 * D2 also owns removals, lineage/deletion and cross-revision delta verification.
 * D3 still owns source attribution, explicit statements and every policy gate.
 * In particular, D3 must keep partial message self-attribution unresolved;
 * mapping its role to body is not proof of unquoted/unsigned personal speech.
 * DTO IDs hash long source ids to fit D0's 300-character identifier limit;
 * identity retains the bounded original object tuple for D2's lineage lookup.
 * proposed.participants is independent of authored parts: unique closed
 * {id,kind,self} entries from validated source actors (at most v0.3's 20,
 * below D0's 60). Parts, participants and source facts share source actor IDs
 * scoped by tenant/space/source/account/effective scope. These opaque IDs are
 * NOT global person keys. Names, raw emails and plugin self flags cannot give
 * identity authority. Conflicting repeated actor kinds become unknown; any
 * negative self assertion downgrades. Recipients never get fabricated parts.
 * `evidence` is text-free part metadata; `sourceFacts` contains only declared
 * same-object state or participant response, never attendance/personal promises.
 * There is no transcript/purpose consent grant in the current v0.3 descriptor.
 * Meeting text and server-restricted recruiting text are therefore withheld.
 * @returns {Readonly<CapabilityProjection>}
 */
export function capabilitiesOf({ event, descriptor, binding, authorization, now } = {}) {
  const proof = verdicts.get(authorization)
  if (!proof) return denied("authorization_required")
  if (proof.reason) return denied(proof.reason)
  try {
    bounded(event)
    bounded(descriptor)
    if (now !== proof.now || digest(event) !== proof.event || digest(descriptor) !== proof.descriptor || digest(bindingIdentity(binding)) !== proof.binding) return denied("authorization_mismatch")
    const identity = { source: binding.source, wireSource: event.source, account: event.account, externalId: event.external_id }
    const identityDigest = digest([proof.partition.tenant, proof.partition.space, identity])
    const semanticDigest = digest({ kind: event.kind, text: event.text, actors: event.actors, parts: event.parts ?? [], sections: event.sections ?? [], facts: event.facts ?? [] })
    const actor = event.actors.find((entry) => ["from", "author"].includes(entry.role))
    const partial = event.kind === "message"
    const actorScope = [proof.partition.tenant, proof.partition.space, proof.partition.source, proof.partition.account, proof.partition.scope]
    const actorId = (id) => `actor:${sha256(JSON.stringify([...actorScope, id]))}`
    // Independent source participants are metadata, not synthetic authored
    // parts. One registry keeps every part/participant reference identical.
    // v0.3 bounds actors to 20, below D0's maximum of 60 participants.
    const actors = new Map()
    for (const entry of event.actors) {
      const next = { id: actorId(entry.id), kind: entry.kind ?? "unknown", self: !partial && entry.self !== false && !["bot", "agent", "service"].includes(entry.kind) && proof.self.includes(entry.id) }
      const previous = actors.get(entry.id)
      if (previous) {
        const kind = previous.kind === next.kind ? next.kind : "unknown"
        actors.set(entry.id, { id: next.id, kind, self: kind === "person" && previous.self && next.self })
      } else actors.set(entry.id, next)
    }
    const authorOf = (entry) => actors.get(entry?.id) ?? { id: "unknown", kind: "unknown", self: false }
    const participants = [...actors.values()]
    const role = event.kind === "doc" ? "block" : event.kind === "session" ? "turn" : event.kind === "meeting" ? "transcript" : "body"
    const part = (id, text, entry, stable) => ({ id, role, text, actor: authorOf(entry), hash: sha256(text), stable, expiresAt: null })
    const parts = event.parts?.length
      ? event.parts.map((entry) => part(`part:${sha256(entry.id)}`, entry.text, event.actors.find((actor) => actor.id === entry.actor), true))
      : event.sections?.length
        ? event.sections.map((entry, index) => part(`section:${index}`, entry.text, undefined, false))
        : event.text.trim() ? [part("body", event.text, actor, false)] : []
    if (parts.reduce((sum, entry) => sum + entry.text.length, 0) > 24_000) return denied("evidence_limit")
    // v0.3 domains are recipient DNS domains, NOT semantic purpose. Only an
    // additional server restriction may mark recruiting. No v0.3 field grants
    // purpose/text consent; unknown purpose still needs D3's policy guards.
    const recruiting = proof.recruiting
    const transcript = event.kind === "meeting"
    const textAllowed = !recruiting && !transcript
    const available = textAllowed && parts.some((entry) => entry.text.trim() && !["agent", "bot", "service"].includes(entry.actor.kind)) ? ["bounded_text"] : []
    if (parts.some((entry) => entry.stable)) available.push("stable_parts")
    const sourceFacts = []
    const states = (event.facts ?? []).filter((fact) => proof.item.facts?.includes(fact.type) && fact.type === "commitment" && fact.key === event.external_id && ["issue", "pr", "task"].includes(event.kind))
    if (states.length === 1) {
      available.push("typed_state")
      sourceFacts.push({ field: "facts.commitment.state", value: states[0].state, semanticPromise: false })
    }
    for (const fact of event.facts ?? []) {
      if (fact.type === "meeting.attended" && proof.item.facts?.includes(fact.type)) sourceFacts.push({ field: "participant_response", actor: actorId(fact.actor), value: fact.response, organizer: fact.organizer, attendance: "unknown" })
    }
    const proposed = { ref: `event:${sha256(identityDigest)}`, externalId: `object:${sha256(event.external_id)}`, revision: semanticDigest, partition: proof.partition, kind: event.kind, participants, parts: textAllowed ? parts : [] }
    if (states.length === 1) proposed.state = { field: "state", value: states[0].state }
    const reasons = ["evidence_anchor_required", "revision_order_unknown"]
    if (!parts.length) reasons.push("no_text")
    if (proof.item.details?.length) reasons.push("detail_hydration_not_performed")
    if ((event.facts ?? []).some((fact) => !proof.item.facts?.includes(fact.type))) reasons.push("undeclared_facts")
    if ((event.facts ?? []).length > sourceFacts.length) reasons.push("source_fact_not_projected")
    if (partial && parts.length) reasons.push("segmentation_unavailable")
    if (transcript && parts.length) reasons.push("transcript_consent_unavailable")
    if (recruiting) {
      reasons.push("recruiting_purpose_consent_unavailable")
      proposed.domains = ["recruiting"]
      proposed.textConsent = false
    }
    const evidence = parts.map(({ text: _text, expiresAt: _expiresAt, ...metadata }) => ({ ...metadata, selfAttribution: partial ? "unresolved" : metadata.actor.self ? "server_identity" : "unknown" }))
    const result = { version: 1, readable: true, ready: false, sourceKind: proof.item.kind, identity, partition: proof.partition, pluginDigest: proof.pluginDigest, revision: { token: event.hash, semanticDigest, order: "unknown" }, segmentation: partial ? "partial" : "unavailable", available, eligible: [], reasons, evidence, sourceFacts, proposed }
    return freeze(clone({ ...result, fingerprint: digest(result) }))
  } catch {
    return denied("unsupported_event")
  }
}
