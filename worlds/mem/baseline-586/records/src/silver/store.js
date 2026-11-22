/** Internal storage seam only. No production ingest adapter calls this module.
 * D2B must supply source-validated DTOs, not wire
 * capabilities, revision strings, hashes or retention permissions. */
import { createHash, createHmac, randomBytes, randomUUID } from "node:crypto"
import { eventId } from "../ids.js"
import { SILVER_BUILD, SILVER_PROTECTION_VERSION, SILVER_TABLES } from "./schema.js"
import { SCHEMA_VERSION } from "../schema.js"
import { checkIngest } from "../plugins/consent.js"
import { conflict } from "../errors.js"
import { types } from "node:util"

const DAY = 86_400_000
const SPACE_BYTES = 128 * 1024 * 1024
const MAX_EDGES = 100_000
const CAPABILITIES = ["stableParts", "creationTime", "orderedRevisions", "completeSnapshot"]
const DATA_DEPTH = 32
const DATA_NODES = 4096
const DATA_BYTES = 32768
const digest = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex")
const canonical = (text) => text.normalize("NFKC").replace(/\s+/gu, " ").trim()
const fail = (code) => { throw Object.assign(new Error(`Silver: ${code}`), { code }) }
const iso = (value) => {
  const time = typeof value === "string" ? Date.parse(value) : NaN
  if (!Number.isFinite(time)) fail("invalid_time")
  return new Date(time).toISOString()
}
const required = (value) => {
  if (typeof value !== "string" || !value || Buffer.byteLength(value) > 300) fail("invalid_identity")
  return value
}
function capacity(tx, maxSpaceBytes) {
  if (!Number.isSafeInteger(maxSpaceBytes) || maxSpaceBytes < 1 || maxSpaceBytes > SPACE_BYTES) fail("invalid_storage_limit")
  // Count the entire file, including indices and other layers, rather than
  // presenting a logical byte estimate as a measured physical storage bound.
  const pages = Number(tx.get("pragma page_count").page_count)
  const size = Number(tx.get("pragma page_size").page_size)
  if (pages * size > maxSpaceBytes) fail("storage_capacity")
}
function transaction(tx) {
  if (!(tx.depth > 0)) fail("transaction_required")
}
function erase(tx, eraser, id) {
  if (typeof eraser !== "function") fail("eraser_required")
  const result = eraser(id)
  if (result && typeof result.then === "function") fail("async_eraser")
  if (tx.get("select 1 from records where id=?", id) || tx.get("select 1 from versions where record_id=?", id)) fail("derivative_not_erased")
}
function protect(tx) {
  transaction(tx)
  const version = Number(tx.get("select value from meta where key='schema_version'")?.value)
  const build = tx.get("select value from meta where key='silver_build'")?.value
  if (![SCHEMA_VERSION, SILVER_PROTECTION_VERSION].includes(version) || (build && build !== SILVER_BUILD)) fail("unsupported_silver_build")
  tx.run("insert into meta(key,value) values('silver_build',?) on conflict(key) do update set value=excluded.value", SILVER_BUILD)
  tx.run("update meta set value=? where key='schema_version'", String(SILVER_PROTECTION_VERSION))
  if (!tx.get("select value from meta where key='silver_key'")) {
    tx.run("insert into meta(key,value) values('silver_key',?)", randomBytes(32).toString("hex"))
  }
}
function keys(tx, identity) {
  const source = required(identity?.source)
  const account = identity?.account === undefined ? null : required(identity.account)
  const secret = tx.get("select value from meta where key='silver_key'")?.value
  if (!secret) return null
  const key = (...values) => createHmac("sha256", secret).update(JSON.stringify(values)).digest("hex")
  return { source: key(source), partition: account === null ? null : key(source, account), object: identity.object === undefined ? null : key(source, account, required(identity.object)), part: (id) => key(source, account, identity.object, required(id)) }
}

export function generationFence(tx, identity) {
  const k = keys(tx, identity)
  return k ? Number(tx.get("select generation from silver_fences where partition_key=?", k.partition)?.generation ?? 0) : 0
}

/** Lifecycle changes fence only an already materialized Silver partition.
 * A plain pause in an otherwise feature-off space creates no protected state. */
export function fenceSilver(tx, identity) {
  transaction(tx)
  const k = keys(tx, identity)
  if (!k || !k.partition || (!tx.get("select 1 from silver_objects where partition_key=? limit 1", k.partition) && !tx.get("select 1 from silver_fences where partition_key=?", k.partition))) return false
  tx.run("insert into silver_fences(partition_key,generation) values(?,1) on conflict(partition_key) do update set generation=generation+1", k.partition)
  return true
}

function activeBinding(tx, identity) {
  const binding = tx.get("select owner_id from sources where source=? and account=? and status='confirmed' and enabled=1", identity.source, identity.account)
  if (!binding) fail("source_inactive")
  const consent = tx.get("select scope_json from plugin_consents where source=? and account=?", identity.source, identity.account)
  // Reuse the authoritative lifecycle/owner/declaring-package checks. This
  // empty-event check does not replace D2B's per-input scope/grant validation.
  checkIngest(tx, { ...identity, owner: { id: binding.owner_id }, scope: consent ? JSON.parse(consent.scope_json) : undefined }, [])
}

/** Fingerprint meaningful text only, not labels, plugin hash, revision or
 * normalizer version. Does not change the baseline event content hash. */
export function semanticDigest(evidenceParts) {
  return digest(evidenceParts.map((part) => [required(part.id), canonical(part.text)]))
}

function dataContainer(value) {
  if (!value || typeof value !== "object" || types.isProxy(value)) fail("invalid_request")
  const array = Array.isArray(value)
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== (array ? Array.prototype : Object.prototype) && (array || prototype !== null)) fail("invalid_request")
  return array
}

function ownData(value, key) {
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor && !Object.hasOwn(descriptor, "value")) fail("invalid_request")
  return descriptor?.value
}

// Inspect descriptors, never input accessors or serializer hooks. This is a
// bounded data contract, not a sandbox against modified runtime intrinsics.
function preflightRequest(input, options, resolving) {
  dataContainer(input)
  dataContainer(options)
  const identity = ownData(input, "identity"), receipt = ownData(input, "receipt")
  if (!identity || typeof identity !== "object" || !receipt || typeof receipt !== "object") fail("invalid_identity")
  dataContainer(identity)
  dataContainer(receipt)
  for (const key of ["source", "account", "object"]) required(ownData(identity, key))
  required(ownData(receipt, "id"))
  const sequence = ownData(receipt, "sequence")
  if (!Number.isSafeInteger(sequence) || sequence < 0) fail("invalid_sequence")
  const parts = ownData(input, "evidenceParts")
  if (types.isProxy(parts)) fail("invalid_request")
  if (!Array.isArray(parts) || ownData(parts, "length") > 128) fail("parts_bound")
  for (let i = 0; i < ownData(parts, "length"); i++) {
    if (!Object.hasOwn(parts, i)) fail("invalid_request")
    const part = ownData(parts, String(i))
    if (!part || typeof part !== "object") fail("text_bound")
    dataContainer(part)
    required(ownData(part, "id"))
    const text = ownData(part, "text")
    if (typeof text !== "string" || Buffer.byteLength(text) > 24000) fail("text_bound")
  }
  let bytes = 0, partBytes = 0, nodes = 2
  const charge = (size, inParts) => {
    bytes += size
    if (inParts) partBytes += size
    if (size > 24000 || bytes > DATA_BYTES || partBytes > 24000) fail(inParts ? "text_bound" : "invalid_request")
  }
  const ancestors = new Set()
  const stack = [{ value: options, role: "options", depth: 0, inParts: false }, { value: input, role: "request", depth: 0, inParts: false }]
  while (stack.length) {
    const frame = stack.pop(), value = frame.value
    if (frame.exit) { ancestors.delete(value); continue }
    if (frame.depth > DATA_DEPTH || types.isProxy(value)) fail("invalid_request")
    if (value === undefined || value === null) { charge(value === null ? 4 : 0, frame.inParts); continue }
    if (typeof value === "string") { charge(Buffer.byteLength(value), frame.inParts); continue }
    if (typeof value === "boolean") { charge(value ? 4 : 5, frame.inParts); continue }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) fail(frame.role === "generation" ? "stale_generation" : frame.role === "textDays" ? "invalid_retention_limit" : frame.role === "maxSpaceBytes" ? "invalid_storage_limit" : "invalid_request")
      charge(String(value).length, frame.inParts)
      continue
    }
    if (typeof value !== "object") fail("invalid_request")
    const array = dataContainer(value), keys = Reflect.ownKeys(value)
    if (keys.length > DATA_NODES - nodes || ancestors.has(value)) fail("invalid_request")
    if (array) {
      const length = ownData(value, "length")
      if (length > DATA_NODES) fail("invalid_request")
      for (let i = 0; i < length; i++) if (!Object.hasOwn(value, i)) fail("invalid_request")
    }
    ancestors.add(value)
    stack.push({ value, exit: true })
    for (let i = keys.length - 1; i >= 0; i--) {
      const key = keys[i]
      if (typeof key !== "string") fail("invalid_request")
      if (array && key === "length") continue
      if (array) {
        const index = Number(key)
        if (!Number.isInteger(index) || index < 0 || index >= ownData(value, "length") || String(index) !== key) fail("invalid_request")
      }
      charge(Buffer.byteLength(key), frame.inParts)
      if (++nodes > DATA_NODES) fail("invalid_request")
      // Exactly this one resolver field is ignored, including its descriptor.
      if (resolving && frame.role === "receipt" && key === "generation") continue
      const child = ownData(value, key)
      if (frame.role === "options" && key === "eraseDerivative" && typeof child === "function") {
        if (types.isProxy(child)) fail("invalid_request")
        continue // trusted server callback, outside request data/serialization
      }
      const role = frame.role === "request" && key === "receipt" ? "receipt"
        : frame.role === "receipt" && key === "generation" ? "generation"
          : frame.role === "options" && ["textDays", "maxSpaceBytes"].includes(key) ? key : "data"
      stack.push({ value: child, role, depth: frame.depth + 1, inParts: frame.inParts || (frame.role === "request" && key === "evidenceParts") })
    }
  }
}

// Shared validation and exact existing receipt digest. Memory generation and
// observation time are intentionally not part of logical request identity.
function validatedRequest(input, options = {}, resolving = false) {
  preflightRequest(input, options, resolving)
  const { identity, evidenceParts, capabilities, receipt, retentionPolicy, normalizationPending = false } = input
  const { textDays = 30 } = options
  let { now } = input
  now = iso(now)
  if (!Number.isSafeInteger(textDays) || textDays < 1 || textDays > 30) fail("invalid_retention_limit")
  for (const name of CAPABILITIES) {
    if (capabilities?.[name] !== undefined && typeof capabilities[name] !== "boolean") fail("invalid_capabilities")
  }
  if (!Array.isArray(evidenceParts) || evidenceParts.length > 128) fail("parts_bound")
  if (evidenceParts.some((part) => !part || typeof part.text !== "string" || Buffer.byteLength(part.text) > 24_000) || Buffer.byteLength(JSON.stringify(evidenceParts)) > 24_000) fail("text_bound")
  required(identity?.account)
  if (new Set(evidenceParts.map((part) => part.id)).size !== evidenceParts.length) fail("duplicate_part")
  // A version-shaped input is not consent to extend current retention.
  if (retentionPolicy !== undefined && retentionPolicy !== null) fail("retention_adapter_pending")
  required(receipt?.id)
  if (!Number.isSafeInteger(receipt.sequence) || receipt.sequence < 0) fail("invalid_sequence")
  return { now, requestDigest: digest([evidenceParts, receipt.sequence, capabilities, normalizationPending, textDays]) }
}

/** Read-only reconstruction of one exact request, not replay permission.
 * Resolve and materialize immediately in the same trusted transaction. */
export function resolveSilverRequestGeneration(tx, input, options = {}) {
  transaction(tx)
  const { now, requestDigest } = validatedRequest(input, options, true)
  required(input.identity?.source)
  required(input.identity?.account)
  required(input.identity?.object)
  required(input.receipt?.id)
  if (!Number.isSafeInteger(input.receipt.sequence) || input.receipt.sequence < 0) fail("invalid_sequence")
  if (!Array.isArray(input.evidenceParts) || input.evidenceParts.length > 128) fail("parts_bound")
  for (const part of input.evidenceParts) {
    if (!part || typeof part !== "object") fail("text_bound")
    required(part.id)
  }
  if (input.capabilities !== undefined && (!input.capabilities || typeof input.capabilities !== "object" || Array.isArray(input.capabilities) || Object.keys(input.capabilities).some((key) => !CAPABILITIES.includes(key)))) fail("invalid_capabilities")
  if (input.normalizationPending !== undefined && typeof input.normalizationPending !== "boolean") fail("invalid_normalization_pending")
  activeBinding(tx, input.identity)
  const k = keys(tx, input.identity)
  const generation = generationFence(tx, input.identity)
  if (!Number.isSafeInteger(generation) || generation < 0) fail("invalid_receipt")
  // Raw BLOB lengths inspect complete bytes, unlike TEXT length/substr at NUL.
  // A malformed held row still returns a row, but never its unbounded fields.
  const held = k && tx.get("select case when typeof(digest)='text' and length(cast(digest as blob))=64 then digest end as digest,case when typeof(expires)='text' and length(cast(expires as blob))=24 then expires end as expires,case when length(cast(outcome as blob))<=24000 then outcome end as outcome from silver_receipts where object_key=? and receipt_id=?", k.object, input.receipt.id)
  if (!held) return generation
  if (typeof held.digest !== "string" || !/^[a-f0-9]{64}$/.test(held.digest)) fail("invalid_receipt")
  const expiry = typeof held.expires === "string" ? Date.parse(held.expires) : NaN
  if (held.expires?.length !== 24 || !Number.isFinite(expiry) || new Date(expiry).toISOString() !== held.expires) fail("invalid_receipt")
  if (held.digest !== requestDigest) fail("receipt_conflict")
  let result
  try { result = JSON.parse(held.outcome) } catch { fail("invalid_receipt") }
  const fields = ["status", "evidence", "coverage", "fingerprint", "sequence", "completeSnapshot", "initialPending", "requestGeneration", "generation"]
  if (!result || typeof result !== "object" || Array.isArray(result) || Object.keys(result).length !== fields.length || Object.keys(result).some((key) => !fields.includes(key)) ||
      !Array.isArray(result.evidence) || result.evidence.length > 128 || new Set(result.evidence).size !== result.evidence.length ||
      result.evidence.some((id) => typeof id !== "string" || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)) ||
      !Array.isArray(result.coverage) || result.coverage.length > 128 || result.coverage.some((row) => !row || typeof row !== "object" || Object.keys(row).length !== 1 || !["unknown_age", "text_expired", "part_removed", "normalization_pending"].includes(row.reason)) ||
      result.fingerprint !== semanticDigest(input.evidenceParts) || typeof result.completeSnapshot !== "boolean" || typeof result.initialPending !== "boolean") fail("invalid_receipt")
  const pending = input.normalizationPending ?? false
  if (result.status !== (pending ? "pending" : result.evidence.length ? "ready" : "abstain") ||
      result.completeSnapshot !== (input.capabilities?.completeSnapshot === true && !pending && result.evidence.length > 0 && result.coverage.length === 0) ||
      (result.initialPending && !pending) || (pending && (result.evidence.length > 0 || result.coverage.length !== 1 || result.coverage[0].reason !== "normalization_pending")) ||
      (!pending && result.coverage.some((row) => row.reason === "normalization_pending"))) fail("invalid_receipt")
  const clearCount = input.evidenceParts.filter((part) => canonical(part.text) === "").length
  if (!result || !["ready", "pending", "abstain"].includes(result.status) || result.sequence !== input.receipt.sequence ||
      !Number.isSafeInteger(result.requestGeneration) || result.requestGeneration < 0 || !Number.isSafeInteger(result.generation) ||
      (result.generation !== result.requestGeneration && (clearCount === 0 || result.generation - result.requestGeneration !== clearCount))) fail("invalid_receipt")
  if (result.generation !== generation) fail("stale_generation")
  if (held.expires <= now) fail("receipt_expired")
  return result.requestGeneration
}

export function materializeSilver(tx, input, options = {}) {
  transaction(tx)
  return tx.savepoint(() => materialize(tx, input, options))
}

/** Call-local result only. Nothing is published until the outer transaction
 * commits; refusal rolls back this operation and hard errors still propagate. */
export function materializeSilverOperation(tx, input, options = {}) {
  transaction(tx)
  const refusal = {}
  let result
  try {
    return tx.savepoint(() => {
      result = materialize(tx, input, options, true)
      if (result.disposition === "refused") throw refusal
      return result
    })
  } catch (error) {
    if (error === refusal) return result
    throw error
  }
}

function materialize(tx, input, options = {}, operation = false) {
  transaction(tx)
  const validated = validatedRequest(input, options)
  const { identity, evidenceParts, capabilities, receipt, normalizationPending = false } = input
  const { eraseDerivative, maxSpaceBytes = SPACE_BYTES, textDays = 30 } = options
  const now = validated.now
  const fingerprint = semanticDigest(evidenceParts)
  const sourceProof = digest([evidenceParts, capabilities, textDays])
  protect(tx)
  const k = keys(tx, identity)
  required(identity.object)
  const requestDigest = validated.requestDigest
  const held = tx.get("select digest,outcome,expires from silver_receipts where object_key=? and receipt_id=?", k.object, receipt.id)
  const generation = generationFence(tx, identity)
  // Only an unexpired fingerprint/status snapshot of this exact object. No
  // source text, history, receipt archive, or generic SQL reader is exposed.
  const snapshot = () => {
    const row = tx.get("select status,fingerprint from silver_objects where object_key=? and removed=0 and fingerprint is not null and fingerprint_expires>?", k.object, now)
    return row ? { status: row.status, fingerprint: row.fingerprint } : null
  }
  const before = operation ? snapshot() : null
  // Call-local branch effects only; never part of the durable receipt result.
  // The existing 128-span admission bounds the disjoint union of these sets.
  const freshEvidenceIds = new Set(), carriedEvidenceIds = new Set()
  const done = (disposition, result) => {
    if (!operation) return result
    const after = disposition === "refused" ? before : snapshot()
    const anchoring = { freshEvidenceIds: disposition === "accepted" ? [...freshEvidenceIds] : [], carriedEvidenceIds: disposition === "accepted" ? [...carriedEvidenceIds] : [] }
    return { disposition, result, generation: disposition === "refused" ? generation : generationFence(tx, identity), before, after, changed: JSON.stringify(before) !== JSON.stringify(after), anchoring }
  }
  const replay = (result) => {
    // A current caller epoch cannot re-authorize an older durable receipt.
    // Exact self-fenced clears keep their original request/result epochs.
    if (operation && (result.generation !== generation || result.requestGeneration !== receipt.generation)) fail("stale_generation")
    return operation && held.expires <= now
      ? done("refused", { status: "abstain", evidence: [], coverage: [{ reason: "receipt_expired" }] })
      : done("replayed", result)
  }
  if (receipt.generation !== generation) {
    const cached = held && JSON.parse(held.outcome)
    // A clear can fence its own transaction. Replay only that exact receipt,
    // never a result from before a later erase or consent transition.
    if (!cached || held.digest !== requestDigest || cached.requestGeneration !== receipt.generation || cached.generation !== generation || cached.generation === cached.requestGeneration) fail("stale_generation")
    activeBinding(tx, identity)
    return replay(cached)
  }
  activeBinding(tx, identity)
  if (held) {
    if (held.digest !== requestDigest) fail("receipt_conflict")
    return replay(JSON.parse(held.outcome))
  }
  capacity(tx, maxSpaceBytes)
  if (Number(tx.get("select count(*) as n from silver_objects").n) >= 50_000 ||
      Number(tx.get("select count(*) as n from silver_evidence").n) + evidenceParts.length > 100_000 ||
      Number(tx.get("select count(*) as n from silver_receipts").n) >= 50_000) fail("storage_capacity")
  const prior = tx.get("select * from silver_objects where object_key=?", k.object)
  const completing = prior?.status === "pending" && !normalizationPending && receipt.sequence === prior.sequence && fingerprint === prior.fingerprint && sourceProof === prior.pending_proof
  const initialPending = completing && Boolean(tx.get("select 1 from silver_receipts where object_key=? and json_extract(outcome,'$.sequence')=? and json_extract(outcome,'$.initialPending')=1 limit 1", k.object, prior.sequence))
  if (prior?.removed || (prior && receipt.sequence <= prior.sequence && !completing)) return done("refused", { status: "abstain", coverage: [{ reason: "stale_revision" }], evidence: [] })
  if (prior) for (const part of evidenceParts) {
    if (canonical(part.text) !== "") continue
    // An explicit supplied clear is an invalidation even though it has no
    // nonempty span. Refresh comparisons only after its evidence is erased.
    invalidateSilver(tx, { identity: { ...identity, part: part.id } }, eraseDerivative)
  }
  const priorEvidence = tx.all("select * from silver_evidence where object_key=? limit 513", k.object)
  const comparisonGap = () => {
    // Supplied clears can already have erased data and fenced the partition.
    // Throw through both savepoint and page transaction rather than commit an
    // unreceipted partial clear or advance its caller's cursor on refusal.
    if (evidenceParts.some((part) => canonical(part.text) === "")) fail("comparison_bound")
    return done("refused", { status: "abstain", evidence: [], coverage: [{ reason: "comparison_bound" }] })
  }
  // The extra row detects overflow; never treat a truncated history as proof.
  if (priorEvidence.length > 512) return comparisonGap()
  const rawSpans = evidenceParts.flatMap((part) => part.text.split(/\n\s*\n/u).filter((text) => canonical(text)).map((text) => ({ ...part, text })))
  const live = (row) => row.active && row.text !== null && row.text_expires > now
  // Retirement removes current support, not permitted comparison history.
  // Every unexpired span in this exact object participates in age proof.
  const permitted = priorEvidence.filter((row) => row.text !== null && row.text_expires > now)
  if (permitted.reduce((bytes, row) => bytes + Buffer.byteLength(row.text), 0) > 24_000) return comparisonGap()
  const known = permitted.map((row) => canonical(row.text)).sort((a, b) => b.length - a.length)
  // Split copied prefixes before deciding whether anything is new. Source-part
  // birth says nothing about the age of wording copied into that part.
  const spans = rawSpans.flatMap((part) => {
    let remaining = canonical(part.text)
    const pieces = []
    while (remaining) {
      const copied = known.find((text) => remaining === text || remaining.startsWith(`${text} `))
      pieces.push({ ...part, text: copied ?? remaining })
      remaining = copied ? remaining.slice(copied.length).trim() : ""
      if (pieces.length > 128) fail("evidence_capacity")
    }
    return pieces
  })
  if (spans.length > 128) fail("evidence_capacity")
  if (priorEvidence.length + spans.length > 512) return comparisonGap()
  // Only a complete, still-live prior receipt can prove a bounded append.
  // Its payload is generated here, not a plugin-supplied novelty assertion.
  const baseline = prior && capabilities?.completeSnapshot && capabilities?.orderedRevisions && tx.get("select outcome from silver_receipts where object_key=? and json_extract(outcome,'$.sequence')=? and json_extract(outcome,'$.completeSnapshot')=1 and json_extract(outcome,'$.status')='ready' limit 1", k.object, prior.sequence)
  const baselineIds = baseline ? JSON.parse(baseline.outcome).evidence : []
  const baselineRows = baselineIds.map((id) => priorEvidence.find((row) => row.id === id))
  // Expired/missing text is not comparison authority, even in a worker that
  // crossed expiry before maintenance installed its suppression marks.
  const historyComplete = permitted.length === priorEvidence.length && !tx.get("select 1 from silver_part_tombstones where object_key=? limit 1", k.object)
  const baselineLive = historyComplete && baselineRows.length > 0 && baselineRows.every((row) => row && live(row))
  const baselineText = baselineLive ? canonical(baselineRows.map((row) => row.text).join(" ")) : ""
  const incomingText = canonical(rawSpans.map((part) => part.text).join(" "))
  const append = baselineLive && incomingText.startsWith(`${baselineText} `)
  const oldWords = new Set(known.flatMap((text) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []))
  const incomingHashes = new Set(spans.map((part) => digest(canonical(part.text))))
  const incomingParts = [...new Set(evidenceParts.map((part) => k.part(part.id)))]
  const suppliedEvidence = new Set(incomingParts.length ? tx.all(`select evidence_id from silver_memberships where object_key=? and part_key in (${incomingParts.map(() => "?").join(",")})`, k.object, ...incomingParts).map((row) => row.evidence_id) : [])
  const retired = priorEvidence.filter((row) => row.active && !incomingHashes.has(row.digest) && (capabilities?.completeSnapshot || suppliedEvidence.has(row.id)))
  for (const row of normalizationPending ? [] : retired) {
    for (const edge of tx.all("select derivative_id from silver_edges where evidence_id=?", row.id)) {
      if (typeof eraseDerivative !== "function") fail("derivative_invalidation_required")
      erase(tx, eraseDerivative, edge.derivative_id)
      removeDerivativeEdges(tx, edge.derivative_id)
    }
    tx.run("update silver_evidence set active=0 where id=?", row.id)
  }
  const evidence = []
  const coverage = []
  for (const part of normalizationPending ? [] : spans) {
    const partKey = k.part(part.id)
    const tombstone = tx.get("select reason from silver_part_tombstones where object_key=? and part_key=?", k.object, partKey)
    if (tombstone) {
      coverage.push({ reason: tombstone.reason === "expired" ? "text_expired" : "part_removed" })
      continue
    }
    const meaning = canonical(part.text)
    const hash = digest(meaning)
    const old = tx.get("select * from silver_evidence where object_key=? and digest=? order by anchored_at limit 1", k.object, hash)
    if (old) {
      const expires = new Date(Math.min(Date.parse(old.text_expires), Date.parse(old.anchored_at) + textDays * DAY)).toISOString()
      tx.run("update silver_evidence set text_expires=?,metadata_expires=min(metadata_expires,?) where id=?", expires, expires, old.id)
      if (old.text && expires > now) {
        evidence.push(old.id)
        // Reuse through another membership cannot demote a unit first anchored
        // by this invocation or classify that unit in both lists.
        if (!freshEvidenceIds.has(old.id)) carriedEvidenceIds.add(old.id)
        tx.run("update silver_evidence set active=1 where id=?", old.id)
        tx.run("insert or ignore into silver_memberships(object_key,part_key,evidence_id) values(?,?,?)", k.object, partKey, old.id)
      }
      else coverage.push({ reason: "text_expired" })
      continue
    }
    // Bounded snapshot fallback can prove copied wording, not that a changed
    // paragraph's every word is new. Novel unmatched spans abstain until D2B
    // supplies broader delta proof; revision hints never renew.
    const containing = permitted.filter((row) => canonical(row.text).includes(meaning)).sort((a, b) => a.anchored_at.localeCompare(b.anchored_at))[0]
    const carried = containing && capabilities?.orderedRevisions && (capabilities?.stableParts || capabilities?.completeSnapshot)
    const verifiedCreation = capabilities?.creationTime && capabilities?.orderedRevisions && part.createdAt &&
      (!prior || initialPending) &&
      (capabilities?.stableParts || capabilities?.completeSnapshot)
    const words = meaning.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
    const verifiedAppend = append && words.length > 0 && words.every((word) => !oldWords.has(word))
    if (!carried && !verifiedCreation && !verifiedAppend) {
      coverage.push({ reason: "unknown_age" })
      continue
    }
    // A mechanical segmentation change is not new text. Carry the earliest
    // containing permitted span's anchor, including inactive source revisions.
    const sourceBirth = verifiedCreation ? iso(part.createdAt) : null
    const anchor = carried ? containing.anchored_at : completing ? prior.observed_at : now
    const expires = new Date(Math.min(Date.parse(anchor) + textDays * DAY, containing ? Date.parse(containing.text_expires) : Infinity, sourceBirth ? Date.parse(sourceBirth) + textDays * DAY : Infinity)).toISOString()
    if ((sourceBirth && sourceBirth > now) || anchor > now || expires <= now) {
      coverage.push({ reason: "unknown_age" })
      continue
    }
    const id = randomUUID()
    tx.run("insert into silver_evidence(id,object_key,part_key,digest,text,anchored_at,text_expires,metadata_expires,revision) values(?,?,?,?,?,?,?,?,?)", id, k.object, partKey, hash, part.text, anchor, expires, expires, receipt.sequence)
    tx.run("insert into silver_memberships(object_key,part_key,evidence_id) values(?,?,?)", k.object, partKey, id)
    evidence.push(id)
    if (carried) carriedEvidenceIds.add(id)
    else freshEvidenceIds.add(id)
  }
  if (normalizationPending) coverage.push({ reason: "normalization_pending" })
  // The operation seam accepts admitted evidence, pending observations, or
  // explicit clears. With none of those, undo tentative retirement/erasure.
  // The legacy seam retains its historical abstaining-observation receipt.
  if (operation && !normalizationPending && evidence.length === 0 && !evidenceParts.some((part) => canonical(part.text) === "")) {
    return done("refused", { status: "abstain", evidence: [], coverage })
  }
  const outcome = { status: normalizationPending ? "pending" : evidence.length ? "ready" : "abstain", evidence: [...new Set(evidence)], coverage, fingerprint,
    sequence: receipt.sequence, completeSnapshot: capabilities?.completeSnapshot === true && !normalizationPending && evidence.length > 0 && coverage.length === 0,
    initialPending: normalizationPending && !prior, requestGeneration: receipt.generation, generation: generationFence(tx, identity) }
  const expiry = evidence.length ? tx.get("select min(metadata_expires) as expires from silver_evidence where object_key=? and active=1", k.object).expires : new Date(Date.parse(now) + textDays * DAY).toISOString()
  tx.run("insert into silver_objects(object_key,partition_key,source_key,event_ref,sequence,status,fingerprint,pending_proof,fingerprint_expires,observed_at) values(?,?,?,?,?,?,?,?,?,?) on conflict(object_key) do update set sequence=excluded.sequence,status=excluded.status,fingerprint=excluded.fingerprint,pending_proof=excluded.pending_proof,fingerprint_expires=excluded.fingerprint_expires,observed_at=excluded.observed_at", k.object, k.partition, k.source, eventId(identity.source, identity.account, identity.object), receipt.sequence, outcome.status, evidence.length || normalizationPending ? fingerprint : null, normalizationPending ? sourceProof : null, expiry, now)
  tx.run("insert into silver_receipts(object_key,receipt_id,digest,outcome,expires) values(?,?,?,?,?)", k.object, receipt.id, requestDigest, JSON.stringify(outcome), new Date(Math.min(Date.parse(expiry), Date.parse(now) + 30 * DAY)).toISOString())
  if (Number(tx.get("select count(*) as n from silver_evidence").n) > 100_000 ||
      Number(tx.get("select count(*) as n from silver_memberships").n) > 100_000 ||
      Number(tx.get("select count(*) as n from silver_memberships where object_key=?", k.object).n) > 512) fail("storage_capacity")
  capacity(tx, maxSpaceBytes)
  return done("accepted", outcome)
}

const view = (row) => ({ id: row.id, part: row.part_key, revision: row.revision, text: row.text, anchoredAt: row.anchored_at, textExpires: row.text_expires })

export function listLiveEvidence(tx, { identity, now, limit = 128, after = null }) {
  now = iso(now)
  if (!Number.isInteger(limit) || limit < 1 || limit > 128) fail("read_bound")
  const k = keys(tx, identity)
  if (!k) return { evidence: [], next: null }
  const cursor = after === null ? null : tx.get("select anchored_at,id from silver_evidence where object_key=? and id=?", k.object, required(after))
  if (after !== null && !cursor) fail("invalid_evidence_cursor")
  const tail = cursor ? " and (e.anchored_at>? or (e.anchored_at=? and e.id>?))" : ""
  const rows = tx.all(`select e.* from silver_evidence e join silver_objects o on o.object_key=e.object_key where o.object_key=? and o.removed=0 and o.status='ready' and e.active=1 and e.text_expires>? and e.text is not null${tail} order by e.anchored_at,e.id limit ?`, k.object, now, ...(cursor ? [cursor.anchored_at, cursor.anchored_at, cursor.id] : []), limit + 1)
  const page = rows.slice(0, limit)
  return { evidence: page.map(view), next: rows.length > limit ? page.at(-1).id : null }
}

export function readLiveEvidence(tx, { identity, ids, now }) {
  now = iso(now)
  if (!Array.isArray(ids) || ids.length > 128) fail("read_bound")
  ids.forEach(required)
  const k = keys(tx, identity)
  if (!k || !ids.length) return { evidence: [] }
  return { evidence: tx.all(`select e.* from silver_evidence e join silver_objects o on o.object_key=e.object_key where o.object_key=? and o.removed=0 and o.status='ready' and e.active=1 and e.text_expires>? and e.text is not null and e.id in (${ids.map(() => "?").join(",")}) order by e.anchored_at,e.id`, k.object, now, ...ids).map(view) }
}

/** Text expiry never removes a deletion edge. Once no derivative remains,
 * expired evidence can disappear; opaque object ordering/suppression stays. */
export function expireSilver(tx, now) {
  transaction(tx)
  now = iso(now)
  const texts = Number(tx.run("update silver_evidence set text=null where text_expires<=? and text is not null", now).changes)
  let changed = texts
  tx.run("insert or ignore into silver_part_tombstones(object_key,part_key,reason) select object_key,part_key,'expired' from silver_evidence where text_expires<=?", now)
  tx.run("insert or ignore into silver_part_tombstones(object_key,part_key,reason) select m.object_key,m.part_key,'expired' from silver_memberships m join silver_evidence e on e.id=m.evidence_id where e.text_expires<=?", now)
  changed += Number(tx.run("update silver_evidence set digest=null,policy_version=null where metadata_expires<=? and (digest is not null or policy_version is not null)", now).changes)
  changed += Number(tx.run("delete from silver_evidence where metadata_expires<=? and id not in (select evidence_id from silver_edges)", now).changes)
  changed += Number(tx.run("delete from silver_memberships where evidence_id not in (select id from silver_evidence)").changes)
  changed += Number(tx.run("delete from silver_receipts where expires<=?", now).changes)
  changed += Number(tx.run("update silver_objects set fingerprint=null,pending_proof=null,fingerprint_expires=null,observed_at=null where fingerprint_expires<=?", now).changes)
  return { texts, changed }
}

/** Exact edges for existing records only. Future Gold/cache kinds must add an
 * eraser before admission. The optional limit is server/test configuration. */
export function addDerivativeEdges(tx, input, options = {}) {
  transaction(tx)
  return tx.savepoint(() => addEdges(tx, input, options))
}

function addEdges(tx, { derivativeId, evidenceIds, identity, generation, now }, { maxEdges = MAX_EDGES, maxSpaceBytes = SPACE_BYTES } = {}) {
  transaction(tx)
  now = iso(now)
  if (!Number.isSafeInteger(maxEdges) || maxEdges < 1 || maxEdges > MAX_EDGES) fail("invalid_lineage_limit")
  capacity(tx, maxSpaceBytes)
  if (generation !== generationFence(tx, identity)) fail("stale_generation")
  if (!Array.isArray(evidenceIds) || evidenceIds.length === 0 || evidenceIds.length > 4096) fail("lineage_capacity")
  if (!tx.get("select 1 from records where id=?", required(derivativeId))) fail("unsupported_derivative")
  const k = keys(tx, identity)
  if (!k) fail("missing_evidence")
  activeBinding(tx, identity)
  const ids = [...new Set(evidenceIds)]
  for (const id of ids) {
    const row = tx.get("select e.id from silver_evidence e join silver_objects o on o.object_key=e.object_key where e.id=? and o.partition_key=? and o.removed=0 and o.status='ready' and e.active=1 and e.text_expires>? and e.text is not null", required(id), k.partition, now)
    if (!row) fail("missing_evidence")
  }
  const added = ids.filter((id) => !tx.get("select 1 from silver_edges where derivative_id=? and evidence_id=?", derivativeId, id))
  if (Number(tx.get("select count(*) as n from silver_edges").n) + added.length > maxEdges) fail("lineage_capacity")
  for (const id of added) tx.run("insert into silver_edges(derivative_id,evidence_id) values(?,?)", derivativeId, id)
  capacity(tx, maxSpaceBytes)
  return { added: added.length }
}

export function derivativeEvidence(tx, derivativeId) {
  return tx.all("select evidence_id from silver_edges where derivative_id=? order by evidence_id", derivativeId).map((row) => row.evidence_id)
}

export function removeDerivativeEdges(tx, derivativeId) {
  transaction(tx)
  return Number(tx.run("delete from silver_edges where derivative_id=?", derivativeId).changes)
}

/** Invalidate inside the caller's erase transaction. No display-citation cap.
 * The callback erases a registered record including versions, or throws. */
export function invalidateSilver(tx, { identity, refs, before, all = false }, eraseDerivative) {
  transaction(tx)
  return tx.savepoint(() => invalidate(tx, { identity, refs, before, all }, eraseDerivative))
}

function invalidate(tx, { identity, refs, before, all = false }, eraseDerivative) {
  transaction(tx)
  if (!tx.get("select value from meta where key='silver_key'")) return { derivatives: 0 }
  const k = identity ? keys(tx, identity) : null
  const where = []
  const args = []
  if (k?.source) { where.push("source_key=?"); args.push(k.source) }
  if (k?.partition) { where.push("partition_key=?"); args.push(k.partition) }
  if (k?.object) { where.push("object_key=?"); args.push(k.object) }
  if (refs) {
    if (!refs.length) return { derivatives: 0 }
    where.push(`event_ref in (${refs.map(() => "?").join(",")})`)
    args.push(...refs)
    // Legacy event IDs hash a colon-joined tuple. They are lookup aliases,
    // not canonical identity. Refuse ambiguity before any fence or erasure,
    // including collisions with an already removed object's suppression row.
    if (tx.get(`select event_ref from silver_objects where ${where.join(" and ")} group by event_ref having count(*)>1 limit 1`, ...args)) {
      throw conflict("ambiguous_evidence_ref", "A legacy event reference matches multiple canonical Silver objects. Nothing was erased.", "Use source/account scope or an identity-qualified source removal.")
    }
  }
  if (before) { where.push("(exists (select 1 from silver_evidence e where e.object_key=silver_objects.object_key and e.anchored_at<?) or status in ('pending','abstain'))"); args.push(iso(before)) }
  if (!where.length && !all) fail("erase_scope_required")
  const objects = tx.all(`select object_key,partition_key from silver_objects ${where.length ? `where ${where.join(" and ")}` : ""}`, ...args)
  const partitions = new Set(objects.map((row) => row.partition_key))
  if (k?.partition && (tx.get("select 1 from sources where source=? and account=?", identity.source, identity.account) || tx.get("select 1 from silver_fences where partition_key=?", k.partition))) partitions.add(k.partition)
  if (all && !identity && !refs && !before) {
    for (const row of tx.all("select partition_key from silver_fences")) partitions.add(row.partition_key)
    for (const row of tx.all("select source,account from sources")) partitions.add(keys(tx, row).partition)
  } else if (identity?.source && !identity.account && !before) {
    for (const row of tx.all("select source,account from sources where source=?", identity.source)) partitions.add(keys(tx, row).partition)
  }
  // Fence even an already empty account before evidence/derivative deletion.
  for (const partition of partitions) tx.run("insert into silver_fences(partition_key,generation) values(?,1) on conflict(partition_key) do update set generation=generation+1", partition)
  const removed = new Set()
  let evidence = 0
  for (const object of objects) {
    const part = identity?.part === undefined ? null : k.part(identity.part)
    const filter = "object_key=?" + (part ? " and id in (select evidence_id from silver_memberships where object_key=? and part_key=?)" : "") + (before ? " and anchored_at<?" : "")
    const params = [object.object_key, ...(part ? [object.object_key, part] : []), ...(before ? [iso(before)] : [])]
    if (part || before) tx.run(`insert or replace into silver_part_tombstones(object_key,part_key,reason) select object_key,part_key,'removed' from silver_memberships where evidence_id in (select id from silver_evidence where ${filter})`, ...params)
    for (const row of tx.all(`select distinct derivative_id from silver_edges where evidence_id in (select id from silver_evidence where ${filter})`, ...params)) {
      if (removed.has(row.derivative_id)) continue
      erase(tx, eraseDerivative, row.derivative_id)
      removeDerivativeEdges(tx, row.derivative_id)
      removed.add(row.derivative_id)
    }
    evidence += Number(tx.run(`delete from silver_evidence where ${filter}`, ...params).changes)
    tx.run("delete from silver_memberships where evidence_id not in (select id from silver_evidence)")
    tx.run("delete from silver_receipts where object_key=?", object.object_key)
    if (part) tx.run("insert into silver_part_tombstones(object_key,part_key,reason) values(?,?,'removed') on conflict(object_key,part_key) do update set reason='removed'", object.object_key, part)
    tx.run("update silver_objects set fingerprint=null,pending_proof=null,fingerprint_expires=null,observed_at=null where object_key=?", object.object_key)
    if (!part && !before) {
      tx.run("delete from silver_part_tombstones where object_key=?", object.object_key)
      tx.run("update silver_objects set removed=1,fingerprint=null,pending_proof=null,fingerprint_expires=null,observed_at=null where object_key=?", object.object_key)
    }
  }
  if (objects.length > 0) tx.erasePending = true
  return { derivatives: removed.size, evidence }
}

/** Offline, drained-cell rollback only. An ACK never substitutes for erasure.
 * Refuses to unprotect a file if any registered derivative cannot be erased.
 * The caller must checkpoint/close after the outer transaction commits. */
export function prepareSilverRollback(tx, eraseDerivative) {
  transaction(tx)
  return tx.savepoint(() => {
    if (tx.get("select value from meta where key='silver_build'")?.value !== SILVER_BUILD ||
        Number(tx.get("select value from meta where key='schema_version'")?.value) !== SILVER_PROTECTION_VERSION) fail("unsupported_silver_build")
    const erased = invalidateSilver(tx, { all: true }, eraseDerivative)
    for (const table of SILVER_TABLES) tx.run(`delete from ${table}`)
    tx.run("delete from meta where key in ('silver_build','silver_key')")
    tx.run("update meta set value=? where key='schema_version'", String(SCHEMA_VERSION))
    return erased
  })
}
