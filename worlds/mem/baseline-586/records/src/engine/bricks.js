/** D0: offline core contract only. No execution, filing, cache or lineage store. */
import { canonicalJson } from "../action-grant.js"
import { sha256 } from "../ids.js"
import { CORE_TYPES } from "../claims/registry.js"
import { checkSubject, checkAttribute, knowledgeKey, claimKey, normaliseTask } from "../claims/keys.js"
import { candidateJudgement, shapes } from "../routines/guards.js"
import { lexiconTraits } from "../routines/traits.js"
import { isWorkPromise, decisionEvidence } from "../routines/extract.js"
import { isDay } from "../routines/dates.js"

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child)
    Object.freeze(value)
  }
  return value
}

const spec = (id, mode, required, types) => ({ id: `core.${id}`, version: 1, mode, required, types, schema: "claims/registry.js", schemaVersion: 1, policy: "review-first/explicit-statement/trait-gate" })
export const CORE_BRICKS = freeze([
  spec("commitments", "structured", ["bounded_text"], ["commitment"]),
  spec("decisions", "structured", ["bounded_text"], ["decision"]),
  spec("durable-facts", "structured", ["bounded_text"], ["fact", "preference", "constraint"]),
  spec("work-item-state", "rule", ["typed_state"], ["fact"]),
])
const digest = (value) => sha256(canonicalJson(value))
const fail = (code) => { throw Object.assign(new Error(code), { code }) }
const text = (value, max = 300) => typeof value === "string" && value.trim().length > 0 && value.length <= max
const instant = (value) => text(value, 40) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
function fields(value, allowed, required = allowed) {
  if (!object(value) || Object.keys(value).some((key) => !allowed.includes(key)) || required.some((key) => !Object.hasOwn(value, key))) fail("invalid_fields")
}

/** Only exact Memory-owned core declarations are accepted, never plugin authority. */
export function validateBrick(brick) {
  const core = CORE_BRICKS.find((entry) => entry.id === brick?.id)
  if (!core || !object(brick) || Object.keys(brick).some((key) => !Object.hasOwn(core, key)) || !Array.isArray(brick.types) || brick.types.some((type) => !Object.hasOwn(CORE_TYPES, type)) || canonicalJson(brick) !== canonicalJson(core)) fail("invalid_brick")
  return brick
}

const PARTITION = ["tenant", "space", "source", "account", "scope", "grants", "consent", "consentGroup", "policyEpoch", "lane"]
const VERSIONS = ["schema", "prompt", "model", "normalizer", "context", "hints", "plugin"]

/** One ephemeral, immutable manifest for one authorization partition. No I/O. */
export function brickManifest({ inputs, versions }) {
  fields(versions, VERSIONS)
  if (VERSIONS.some((key) => !text(versions[key])) || versions.schema !== "claims-core@1" || versions.prompt !== "core-extract@1") fail("invalid_versions")
  if (!Array.isArray(inputs) || !inputs.length || inputs.length > 60) fail("invalid_inputs")
  const refs = new Set()
  const units = inputs.map((input) => {
    fields(input, ["ref", "externalId", "revision", "partition", "kind", "parts", "participants", "state", "domains", "textConsent", "removed", "previousRevision", "occurredAt", "observedAt"], ["ref", "externalId", "revision", "partition", "kind", "parts"])
    fields(input.partition, PARTITION)
    if (PARTITION.some((key) => !text(input.partition[key])) || !["own", "general", "backfill"].includes(input.partition.lane)) fail("invalid_partition")
    if (["ref", "externalId", "revision", "kind"].some((key) => !text(input[key])) || refs.has(input.ref)) fail("invalid_input")
    refs.add(input.ref)
    if (!Array.isArray(input.parts) || input.parts.length > 60) fail("invalid_parts")
    const ids = new Set()
    const parts = input.parts.map((part) => {
      fields(part, ["id", "role", "text", "expiresAt", "actor"])
      fields(part.actor, ["id", "kind", "self"], ["id", "kind"])
      if (!text(part.id) || ids.has(part.id) || !["body", "block", "turn", "transcript", "title", "quoted"].includes(part.role) || typeof part.text !== "string" || part.text.length > 24_000 || !instant(part.expiresAt) || !text(part.actor.id) || !["person", "bot", "agent", "service", "unknown"].includes(part.actor.kind) || (part.actor.self !== undefined && typeof part.actor.self !== "boolean")) fail("invalid_part")
      ids.add(part.id)
      return { ...part, hash: sha256(part.text) }
    })
    // Trusted source metadata, not authored evidence or confirmed person links.
    const participants = input.participants === undefined ? [] : input.participants
    if (!Array.isArray(participants) || participants.length > 60) fail("invalid_participants")
    const actors = new Set()
    for (const actor of participants) {
      fields(actor, ["id", "kind", "self"], ["id", "kind"])
      if (!text(actor.id) || actors.has(actor.id) || !["person", "bot", "agent", "service", "unknown"].includes(actor.kind) || (actor.self !== undefined && typeof actor.self !== "boolean")) fail("invalid_participant")
      actors.add(actor.id)
    }
    const capabilities = []
    if (parts.some((part) => ["body", "block", "turn", "transcript"].includes(part.role) && part.text.trim() && !["bot", "agent", "service"].includes(part.actor.kind))) capabilities.push("bounded_text")
    if (input.state !== undefined) {
      fields(input.state, ["field", "value"])
      if (input.state.field !== "state" || typeof input.state.value !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(input.state.value)) fail("invalid_state")
      capabilities.push("typed_state")
    }
    if (input.domains !== undefined && (!Array.isArray(input.domains) || input.domains.some((domain) => !text(domain, 80)))) fail("invalid_domains")
    for (const key of ["textConsent", "removed"]) if (input[key] !== undefined && typeof input[key] !== "boolean") fail("invalid_input")
    if (input.previousRevision !== undefined && !text(input.previousRevision)) fail("invalid_input")
    for (const key of ["occurredAt", "observedAt"]) if (input[key] !== undefined && !instant(input[key])) fail("invalid_input")
    const recruiting = input.domains?.includes("recruiting") && input.textConsent !== true
    const eligible = input.removed === true ? [] : CORE_BRICKS.filter((brick) => !(recruiting && brick.mode === "structured") && brick.required.every((capability) => capabilities.includes(capability))).map((brick) => brick.id)
    return { ...input, parts, participants, capabilities, eligible, disposition: eligible.length ? "eligible" : "abstain", hash: digest(input) }
  })
  const partition = units[0].partition
  if (units.some((unit) => canonicalJson(unit.partition) !== canonicalJson(partition))) fail("mixed_partition")
  if (units.reduce((sum, unit) => sum + unit.parts.reduce((n, part) => n + part.text.length, 0), 0) > 24_000) fail("input_limit")
  const body = { version: 1, partition, versions, bricks: CORE_BRICKS.map((brick) => ({ ...brick, digest: digest(brick) })), inputs: units }
  // Clone before freezing: never freeze or retain mutable caller-owned objects.
  return freeze(JSON.parse(canonicalJson({ ...body, digest: digest(body) })))
}

const STATUSES = ["success", "no-match", "abstain", "held", "invalid", "retry", "expired"]
const semanticPart = (part) => ["body", "block", "turn", "transcript"].includes(part.role) && !["bot", "agent", "service"].includes(part.actor.kind)

// Source actor identities are deliberately not person links or proof of self.
const actorSubject = (partition, id) => `sources/${digest([partition.tenant, partition.space, partition.source, partition.account, partition.scope, id]).slice(0, 24)}`
function commitment(claim, part, unit, manifest) {
  if (!text(claim.owner) || part.actor.kind !== "person" || claim.owner !== part.actor.id) fail("invalid_owner")
  if (claim.counterparty !== null && (!text(claim.counterparty) || !unit.participants.some((actor) => actor.kind === "person" && actor.id === claim.counterparty))) fail("invalid_counterparty")
  const task = normaliseTask(claim.task)
  if (!text(claim.task) || !isWorkPromise(`I'll ${task}`) || !` ${normaliseTask(claim.quote)} `.includes(` ${task} `) || claim.attribute !== "state") fail("invalid_task")
  const owner = actorSubject(manifest.partition, claim.owner)
  const counterparty = claim.counterparty === null ? null : actorSubject(manifest.partition, claim.counterparty)
  const key = knowledgeKey("commitment", { owner, counterparty, task })
  // D0 has no trusted timezone/calendar context for relative date resolution.
  if (claim.due != null && (typeof claim.due !== "string" || !isDay(claim.due) || !claim.quote.split(/[^0-9A-Za-z-]+/).includes(claim.due))) fail("invalid_due")
  if (claim.trigger != null && (!text(claim.trigger) || !claim.quote.includes(claim.trigger))) fail("invalid_trigger")
  if (claim.subject !== undefined && claim.subject !== owner) fail("invalid_owner")
  if (claim.knowledge_key !== undefined && claim.knowledge_key !== key) fail("invalid_knowledge")
  return { ...claim, subject: owner, owner, counterparty, task, due: claim.due ?? null, trigger: claim.trigger ?? null, knowledge_key: key }
}

function candidate(entry, unit, brick, manifest, now) {
  fields(entry, ["claim", "evidence"])
  let claim = entry.claim
  const common = ["type", "subject", "attribute", "value", "statement", "knowledge_key", "stated_by", "quote", "refs"]
  if (claim?.type === "commitment") fields(claim, [...common, "owner", "counterparty", "task", "due", "trigger"], [...common.filter((key) => !["subject", "knowledge_key"].includes(key)), "owner", "counterparty", "task"])
  else fields(claim, common)
  if (!brick.types.includes(claim.type) || !Object.hasOwn(CORE_TYPES, claim.type)) fail("unknown_type")
  if (claim.type !== "commitment") checkSubject(claim.subject)
  checkAttribute(claim.attribute)
  if (!text(claim.statement, 240) || !text(claim.value, 300) || (claim.type !== "commitment" && !text(claim.knowledge_key)) || claim.stated_by !== `source:${manifest.partition.source}`) fail("invalid_claim")
  if (!Array.isArray(claim.refs) || claim.refs.length !== 1 || claim.refs[0] !== unit.ref || !Array.isArray(entry.evidence) || entry.evidence.length !== 1) fail("unknown_ref")
  const evidence = entry.evidence[0]
  if (brick.mode === "rule") {
    fields(evidence, ["ref", "revision", "hash", "field"])
    const subject = `sources/${sha256(canonicalJson([manifest.partition.source, manifest.partition.account, unit.externalId])).slice(0, 24)}`
    if (evidence.ref !== unit.ref || evidence.revision !== unit.revision || evidence.hash !== unit.hash || evidence.field !== "state" || claim.subject !== subject || claim.attribute !== "state" || claim.value !== unit.state?.value || claim.quote !== "" || claim.statement !== `Source state: ${unit.state.value}`) fail("invalid_source_fact")
  } else {
    fields(evidence, ["ref", "revision", "part", "hash", "quote"])
    const part = unit.parts.find((part) => part.id === evidence.part)
    if (!part || evidence.ref !== unit.ref || evidence.revision !== unit.revision || evidence.hash !== part.hash || !semanticPart(part)) fail("unknown_evidence")
    if (Date.parse(part.expiresAt) <= now) fail("expired")
    if (!text(evidence.quote, 300) || evidence.quote.length < 3 || !part.text.includes(evidence.quote) || evidence.quote !== claim.quote) fail("invalid_quote")
    const words = `${claim.statement}\n${claim.value}\n${claim.quote}`
    if (candidateJudgement(words) || lexiconTraits(words).length || shapes(words).any) fail("forbidden_content")
    if (claim.type === "commitment" && (!CORE_TYPES.commitment.transitions.includes(claim.value) || (claim.value === "open" && !isWorkPromise(claim.quote)))) fail("invalid_promise")
    if (claim.type === "commitment") claim = commitment(claim, part, unit, manifest)
    if (claim.type === "decision" && decisionEvidence({ segments: [{ text: part.text }] }, claim.quote) === "none") fail("invalid_decision")
  }
  if (claim.type !== "commitment" && claim.knowledge_key !== knowledgeKey(claim.type, claim)) fail("invalid_knowledge")
  return { claim: { ...claim, source: manifest.partition.source, version: manifest.digest, state: "proposed", claim_key: claimKey(claim.type, claim.knowledge_key, claim.value, claim.attribute) }, evidence: entry.evidence }
}

/**
 * Validate independent (input ref, brick) cells. Omission is unresolved, not
 * no-match. Success means candidate shape/evidence, never permission to file.
 * The trusted caller supplies the manifest; its digest is not an auth token.
 */
export function validateBrickOutcomes(manifest, answers, { now } = {}) {
  const at = Date.parse(now)
  const { digest: expected, ...body } = manifest
  if (!instant(now) || digest(body) !== expected) fail("invalid_manifest")
  if (!Array.isArray(answers) || answers.length > 240) fail("invalid_outcomes")
  const seen = new Map()
  const key = (entry) => canonicalJson([entry.input, entry.brick])
  for (const answer of answers) if (object(answer) && text(answer.input) && text(answer.brick)) seen.set(key(answer), (seen.get(key(answer)) ?? 0) + 1)
  const outcomes = answers.map((answer) => {
    const declared = manifest.bricks.find((brick) => brick.id === answer?.brick)
    const out = (status, reason, claims = []) => ({ input: answer?.input ?? null, brick: answer?.brick ?? null, status, reason, claims, policy: "review-required", manifest: expected, versions: { ...manifest.versions, brick: declared?.digest ?? null }, schema: declared?.schema ?? null })
    try {
      fields(answer, ["input", "brick", "manifest", "versions", "status", "claims", "reason"])
      const unit = manifest.inputs.find((unit) => unit.ref === answer.input)
      const brick = manifest.bricks.find((brick) => brick.id === answer.brick)
      if (!unit || !brick) fail("unknown_input_or_brick")
      if (seen.get(key(answer)) !== 1) fail("duplicate_outcome")
      if (answer.manifest !== expected || canonicalJson(answer.versions) !== canonicalJson({ ...manifest.versions, brick: brick.digest })) fail("version_mismatch")
      if (!STATUSES.includes(answer.status) || !Array.isArray(answer.claims) || answer.claims.length > 60 || !text(answer.reason)) fail("invalid_outcome")
      if (["success", "no-match", "expired"].includes(answer.status) && !unit.eligible.includes(brick.id)) fail("ineligible_input")
      if (answer.status !== "success" && answer.claims.length) fail("unexpected_claims")
      const expired = brick.mode === "structured" && !unit.parts.some((part) => semanticPart(part) && part.text.trim() && Date.parse(part.expiresAt) > at)
      if (answer.status === "expired") {
        if (brick.mode !== "structured") fail("invalid_expiry")
        return expired ? out("expired", "evidence_expired") : out("held", "evidence_live")
      }
      if (["success", "no-match"].includes(answer.status) && expired) return out("expired", "evidence_expired")
      if (answer.status !== "success") {
        return out(answer.status, answer.reason)
      }
      if (!answer.claims.length || !unit.eligible.includes(brick.id)) fail("ineligible_or_empty")
      const claims = answer.claims.map((entry) => candidate(entry, unit, brick, manifest, at))
      // Context contains a digest only in D0, not a validated commitment index.
      if (claims.some((entry) => entry.claim.type === "commitment" && entry.claim.value !== "open")) return out("held", "completion_context_required")
      return out("success", answer.reason, claims)
    } catch (error) {
      // One expired citation cannot retire a cell that still has live evidence.
      return out(error.code === "expired" ? "held" : "invalid", error.code ?? "invalid_claim")
    }
  })
  const unresolved = manifest.inputs.flatMap((unit) => unit.eligible.flatMap((brick) => {
    const answer = outcomes.find((outcome) => outcome.input === unit.ref && outcome.brick === brick)
    return !answer || ["invalid", "held", "retry"].includes(answer.status) ? [{ input: unit.ref, brick, reason: answer?.status ?? "omitted" }] : []
  }))
  return freeze(JSON.parse(canonicalJson({ outcomes, unresolved, complete: unresolved.length === 0 && !outcomes.some((outcome) => outcome.status === "invalid") })))
}
