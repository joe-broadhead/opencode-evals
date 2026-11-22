/** Inert constructor adapter. No production caller installs this factory. */
import { types } from "node:util"
import { descriptorHash } from "../plugins/manifest.js"
import { eventProblems } from "../vendor/source-contract/events.js"
import { storable } from "../storable.js"
import { authorizeCapabilities, capabilitiesOf } from "./capabilities.js"
import { readCall, readerFault, readerOption, syncDependency } from "./silver-readers.js"
import { generationFence, materializeSilverOperation, readLiveEvidence, resolveSilverRequestGeneration } from "../silver/store.js"

const VERSION = "silver-ingest@1"
const canonical = (text) => text.normalize("NFKC").replace(/\s+/gu, " ").trim()
const gap = (reason) => ({ disposition: "unavailable", coverage: [reason] })
const fail = () => { throw new Error("invalid_reader_data") }
const fields = (value, allowed) => {
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).some((key) => !allowed.includes(key))) fail()
}
const line = (value, max = 300) => typeof value === "string" && value.length > 0 && Buffer.byteLength(value) <= max && !/[\u0000-\u001f\u007f]/.test(value)
const instant = (value) => typeof value === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value

// Clone data without executing getters, proxies, serializers or array overrides.
// This bounds the readers' DTOs too, before any shared validator/digest reads.
function data(value, maxBytes = 400_000) {
  let bytes = 0, nodes = 0
  const seen = new Set()
  function visit(item, depth) {
    if (++nodes > 8_000 || depth > 12) fail()
    if (item === null || typeof item === "boolean") return item
    if (typeof item === "number") { if (!Number.isSafeInteger(item)) fail(); return item }
    if (typeof item === "string") { bytes += Buffer.byteLength(item); if (bytes > maxBytes) fail(); return item }
    if (!item || typeof item !== "object" || types.isProxy(item) || seen.has(item)) fail()
    const array = Array.isArray(item)
    if (Object.getPrototypeOf(item) !== (array ? Array.prototype : Object.prototype) && !(Object.getPrototypeOf(item) === null && !array)) fail()
    seen.add(item)
    const out = array ? [] : Object.create(null)
    const keys = Reflect.ownKeys(item)
    if (keys.length > 512) fail()
    let count = 0
    for (const key of keys) {
      if (array && key === "length") continue
      if (typeof key !== "string" || (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= item.length))) fail()
      const property = Object.getOwnPropertyDescriptor(item, key)
      if (!property || !("value" in property) || !property.enumerable) fail()
      bytes += Buffer.byteLength(key)
      if (bytes > maxBytes) fail()
      out[key] = visit(property.value, depth + 1)
      count++
    }
    if (array && count !== item.length) fail()
    seen.delete(item)
    return Object.freeze(out)
  }
  return visit(value, 0)
}

function selected(projection) {
  return projection.proposed.parts.filter((part) => !["bot", "agent", "service"].includes(part.actor.kind))
}

/** Readers are synchronous server-owned reads, never callbacks supplied by RPC.
 * No default source-order, creation, context, person or provenance is invented.
 * Confirmed self-attribution remains unavailable in this JSON-only adapter.
 */
export function createSilverIngest(config = {}) {
  const contextOf = syncDependency(readerOption(config, "contextOf"))
  const proofOf = syncDependency(readerOption(config, "proofOf"))
  const selectionOf = syncDependency(readerOption(config, "selectionOf"))
  const textDays = readerOption(config, "textDays") ?? 30
  const maxSpaceBytes = readerOption(config, "maxSpaceBytes") ?? 128 * 1024 * 1024
  if (!Number.isSafeInteger(textDays) || textDays < 1 || textDays > 30 || !Number.isSafeInteger(maxSpaceBytes) || maxSpaceBytes < 1 || maxSpaceBytes > 128 * 1024 * 1024) throw new Error("invalid_silver_ingest_limits")

  function project(tx, page) {
    let input, context
    try {
      input = data({ wire: page.raw, identity: page.identity, descriptor: page.descriptor, binding: page.binding, scope: page.scope, actor: page.actor, now: page.nowIso })
      if (eventProblems(input.wire).length) return { error: "unsupported_event" }
      if (typeof contextOf !== "function") return { error: "context_unavailable" }
      context = data(readCall(contextOf, tx, [input]), 24_000)
      fields(context, ["tenant", "space", "consentGroup", "policyEpoch", "lane", "grants", "purpose"])
      if (["tenant", "space", "consentGroup", "policyEpoch"].some((key) => !line(context[key])) || context.space !== input.actor.space || !Array.isArray(context.grants) || context.grants.length > 128) fail()
      if (context.purpose !== undefined && context.purpose !== "recruiting") fail()
      for (const grant of context.grants) {
        if (typeof grant === "string") { if (!line(grant)) fail() }
        else { fields(grant, ["prefix", "role"]); if (!line(grant.prefix) || !["viewer", "editor"].includes(grant.role)) fail() }
      }
    } catch (error) { if (readerFault(error) && error.message === "async_silver_reader") throw error; return { error: "context_unavailable" } }
    const args = { handle: tx, event: input.wire, descriptor: input.descriptor, binding: input.binding, context, scope: input.scope, now: input.now }
    const projection = capabilitiesOf({ ...args, authorization: authorizeCapabilities(args) })
    if (!projection.readable) return { error: "authorization_refused" }
    const parts = selected(projection)
    if (!parts.length) return { error: "text_unavailable" }
    if (Object.values(input.identity).some((value) => !line(value))) return { error: "identity_bound" }
    if (input.identity.source !== projection.identity.source || input.identity.account !== projection.identity.account || input.identity.object !== projection.identity.externalId) return { error: "identity_mismatch" }
    let proof
    try {
      if (typeof proofOf !== "function") return { error: "proof_unavailable" }
      proof = data(readCall(proofOf, tx, [data({ ...input, partition: projection.partition, pluginDigest: projection.pluginDigest, parts })]), 32_768)
      fields(proof, ["version", "mappingVersion", "origin", "eventDigest", "descriptorDigest", "pluginDigest", "identity", "partition", "sourceOrder", "stableParts", "completeSnapshot", "textDays", "parts"])
      fields(proof.identity, ["source", "account", "object"])
      fields(proof.partition, ["tenant", "space", "source", "account", "scope", "grants", "consent", "consentGroup", "policyEpoch", "lane"])
      if (proof.version !== 1 || !line(proof.mappingVersion, 100) || proof.origin !== "native" || proof.eventDigest !== descriptorHash(input.wire) || proof.descriptorDigest !== descriptorHash(input.descriptor) || proof.pluginDigest !== projection.pluginDigest || descriptorHash(proof.identity) !== descriptorHash(input.identity) || descriptorHash(proof.partition) !== descriptorHash(projection.partition)) fail()
      if (!Number.isSafeInteger(proof.sourceOrder) || proof.sourceOrder < 0 || typeof proof.stableParts !== "boolean" || typeof proof.completeSnapshot !== "boolean" || (!proof.stableParts && !proof.completeSnapshot) || !Number.isSafeInteger(proof.textDays) || proof.textDays < 1 || proof.textDays > 30) fail()
      if (!Array.isArray(proof.parts) || proof.parts.length !== parts.length || parts.length > 128 || new Set(proof.parts.map((part) => part.id)).size !== parts.length) fail()
      for (const part of proof.parts) {
        fields(part, ["id", "createdAt", "precision"])
        if (!parts.some((entry) => entry.id === part.id) || part.precision !== "millisecond" || !instant(part.createdAt) || part.createdAt > input.now) fail()
      }
    } catch (error) { if (readerFault(error) && error.message === "async_silver_reader") throw error; return { error: "proof_unavailable" } }
    const evidenceParts = parts.map(({ id, text }) => ({ id, text, createdAt: proof.parts.find((part) => part.id === id).createdAt }))
    const limits = { textDays: Math.min(textDays, proof.textDays), maxSpaceBytes }
    if (Buffer.byteLength(JSON.stringify(evidenceParts)) > 24_000) return { error: "evidence_bound" }
    const receipt = { id: descriptorHash([VERSION, input.identity, input.wire, proof, projection.partition, projection.pluginDigest, limits]), sequence: proof.sourceOrder }
    return { input: { identity: input.identity, evidenceParts, capabilities: { stableParts: proof.stableParts, creationTime: true, orderedRevisions: true, completeSnapshot: proof.completeSnapshot }, receipt, now: input.now }, limits, projection, parts, proof }
  }

  function current(tx, page, delta) {
    try {
      if (typeof selectionOf !== "function") return false
      delta = data(delta, 24_000)
      const checked = project(tx, page)
      if (checked.error || checked.input.receipt.id !== delta.receipt || descriptorHash(checked.projection.partition) !== descriptorHash(delta.partition) || generationFence(tx, delta.identity) !== delta.generation) return false
      // Actual latest Bronze wire is a conservative additional fence, not a
      // scope/selection proof. Its content_hash intentionally cannot do this.
      const row = tx.get("select hash,removed_at from events where source=? and account=? and external_id=? limit 1", delta.identity.source, delta.identity.account, delta.identity.object)
      if (!row || row.removed_at || row.hash !== page.raw.hash) return false
      const answer = readCall(selectionOf, tx, [data({ identity: delta.identity, actor: page.actor, now: page.nowIso }, 24_000)])
      const selection = data(answer, 24_000)
      fields(selection, ["version", "identity", "eventDigest", "descriptorDigest", "pluginDigest", "partition", "sourceOrder", "proofDigest", "parts", "expiresAt"])
      fields(selection.identity, ["source", "account", "object"])
      fields(selection.partition, ["tenant", "space", "source", "account", "scope", "grants", "consent", "consentGroup", "policyEpoch", "lane"])
      if (selection.version !== 1 || descriptorHash(selection.identity) !== descriptorHash(delta.identity) || selection.eventDigest !== descriptorHash(page.raw) || selection.descriptorDigest !== descriptorHash(page.descriptor) || selection.pluginDigest !== checked.projection.pluginDigest || descriptorHash(selection.partition) !== descriptorHash(checked.projection.partition) || selection.sourceOrder !== checked.input.receipt.sequence || selection.proofDigest !== descriptorHash(checked.proof) || !instant(selection.expiresAt) || selection.expiresAt <= page.nowIso) return false
      if (!Array.isArray(selection.parts) || selection.parts.length > 128 || new Set(selection.parts.map((part) => part.id)).size !== selection.parts.length) return false
      for (const part of selection.parts) {
        fields(part, ["id", "hash"])
        if (!line(part.id) || typeof part.hash !== "string" || !/^[0-9a-f]{64}$/.test(part.hash)) return false
      }
      if (descriptorHash(selection.parts) !== descriptorHash(checked.parts.map(({ id, hash }) => ({ id, hash })))) return false
      if (delta.kind === "invalidation") return true
      // These immutable candidate IDs came from this exact admitted input's
      // fresh effects. Selection equality establishes association, not text
      // containment, UUID equality, creation time, or a historical raw replay.
      const live = readLiveEvidence(tx, { identity: delta.identity, ids: delta.evidenceIds, now: page.nowIso }).evidence
      return live.length === delta.evidenceIds.length
    } catch (error) { if (readerFault(error) && error.message === "async_silver_reader") throw error; return false }
  }

  function ingest(tx, page) {
    const checked = project(tx, page)
    if (checked.error) return gap(checked.error)
    // A proof read must not let a changed context/binding authorize a previous
    // projection. Re-read actual D1 and source authority just before admission.
    const latest = project(tx, page)
    if (latest.error || checked.input.receipt.id !== latest.input.receipt.id) return gap("authorization_changed")
    const generation = resolveSilverRequestGeneration(tx, latest.input, latest.limits)
    const operation = materializeSilverOperation(tx, { ...latest.input, receipt: { ...latest.input.receipt, generation } }, { ...latest.limits, eraseDerivative: page.eraseDerivative })
    const outcome = { disposition: operation.disposition, status: operation.result.status, coverage: operation.result.coverage.map((entry) => entry.reason), receipt: latest.input.receipt.id, generation: operation.generation }
    if (operation.disposition !== "accepted") return outcome
    const fresh = operation.anchoring.freshEvidenceIds
    const clear = latest.parts.some((part) => !canonical(part.text))
    if (fresh.length || clear) {
      const delta = { kind: fresh.length ? "evidence" : "invalidation", identity: latest.input.identity, fingerprint: operation.result.fingerprint, receipt: latest.input.receipt.id, generation: operation.generation, partition: latest.projection.partition, evidenceIds: fresh }
      // Admission is provisional and independent of publication eligibility.
      // The store checks current selection after all page inputs and COMMIT.
      outcome.delta = data(delta, 24_000)
      if (typeof selectionOf !== "function") outcome.coverage = [...outcome.coverage, "current_selection_unavailable"]
    }
    return outcome
  }

  // Pre-admission server hook. Legacy synthetic D2A hooks remain supported;
  // only this factory requires data-only wire before baseline normalization.
  ingest.prepare = (raw) => {
    try {
      const wire = data(raw)
      const words = [wire.title, wire.text, ...(wire.parts ?? []).map((part) => part.text), ...(wire.sections ?? []).flatMap((section) => [section.heading, section.text]), ...(wire.facts ?? []).map((fact) => fact.title)].filter((value) => typeof value === "string").join("\n")
      if (storable(words, "import").outcome === "refuse") return { error: "secret_refused" }
      return { wire }
    } catch { return { error: "invalid_wire" } }
  }
  ingest.current = current
  return Object.freeze(ingest)
}
