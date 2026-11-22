/**
 * Projections (docs/design/memory-routines-v1.md §4.3, S2 item 3). A record or
 * page line is a projection of claims: it keeps the claim ids it cites, which
 * makes a forget a deterministic cascade. The rules are deterministic:
 *
 * | Rule | What it does |
 * |---|---|
 * | append | a new knowledge key makes a line; an existing one only adds a citation |
 * | transition | a commitment's state is its latest state claim |
 * | upsert | one current value per (subject, attribute) |
 * | reduce | an interface only in v1 (voice arrives later) |
 *
 * A supersession waits for review in v1, in every apply mode. Only
 * `applySupersession` changes a current value, and only a review calls it.
 */
import { ClaimsError } from "./errors.js"
import { canonicalValue } from "./keys.js"
import { precedenceOf, reduceLines as reduceInterface, ruleOf, supersessionVerdict } from "./registry.js"
import { readClaim } from "./rows.js"

export { reduceInterface as reduceLines }

/** The line key of a knowledge key's current projection. */
export function lineKeyOf(knowledgeKey) {
  return `line:${knowledgeKey}`
}

/**
 * Project one filed claim.
 *
 * @param {import("./store.js").ClaimsStore | null} store
 * @param {object} claim
 * @param {{mode?: "propose"|"auto", now?: Date}} [options]
 */
export function project(store, claim, options = {}) {
  if (!store || !claim) return { skipped: "off" }
  const rule = ruleOf(claim.type)
  if (rule === "reduce") return { action: "reduce", supported: false, type: claim.type }
  const at = (options.now ?? new Date()).toISOString()
  if (rule === "append") return claim.type === "commitment" ? appendCommitment(store, claim, at) : appendLine(store, claim, at)
  if (rule === "upsert") return upsert(store, claim, at, options)
  throw new ClaimsError("invalid_rule", `"${rule}" is not a projection rule.`, "Send append, transition, upsert or reduce.")
}

function appendLine(store, claim, at) {
  const line = store.line(lineKeyOf(claim.knowledge_key))
  if (!line) {
    return {
      action: "appended",
      line: store.putLine({
        line_key: lineKeyOf(claim.knowledge_key),
        kind: "line",
        type: claim.type,
        subject: claim.subject,
        attribute: claim.attribute,
        text: claim.statement,
        state: claim.state === "applied" ? "current" : "proposed",
        payload: {},
        claims: [claim.id],
        updated: at,
      }),
    }
  }
  return { action: "cited", line: store.putLine({ ...line, claims: addClaim(line.claims, claim.id), updated: at }) }
}

/** The states a commitment can hold. A claim with one of these values moves it. */
const LIFECYCLE = new Set(["open", "done", "cancelled", "reopened", "snoozed"])

/**
 * A commitment is an append record with a lifecycle and a few upsert fields
 * (design §5.1). A state claim moves it only with sufficient precedence and an
 * applied claim (review H2); any other attribute, such as a due date, is one
 * value per field (review M2).
 */
function appendCommitment(store, claim, at) {
  const line = store.line(lineKeyOf(claim.knowledge_key))
  const stateClaim = claim.attribute === "state" || LIFECYCLE.has(canonicalValue(claim.value))
  if (!line) {
    if (claim.attribute === "state") return { action: "review", reason: "the claim closes a commitment this space does not know" }
    const payload = { commitment: LIFECYCLE.has(canonicalValue(claim.value)) ? canonicalValue(claim.value) : "open" }
    if (!stateClaim) {
      payload.fields = { [claim.attribute]: canonicalValue(claim.value) }
      payload.precedence = { [claim.attribute]: precedenceOf(claim) }
    }
    return {
      action: "appended",
      line: store.putLine({
        line_key: lineKeyOf(claim.knowledge_key),
        kind: claim.type,
        type: claim.type,
        subject: claim.subject,
        attribute: claim.attribute,
        text: claim.statement,
        state: claim.state === "applied" ? "current" : "proposed",
        payload,
        claims: [claim.id],
        updated: at,
      }),
    }
  }
  if (stateClaim) return moveCommitment(store, claim, line, at)
  return commitmentField(store, claim, line, at)
}

function moveCommitment(store, claim, line, at) {
  const from = line.payload?.commitment ?? "open"
  const to = canonicalValue(claim.value)
  if (from === to) {
    return { action: "cited", line: store.putLine({ ...line, claims: addClaim(line.claims, claim.id), updated: at }) }
  }
  // A commitment still awaiting review takes a state claim from any source
  // (design §4.3: a proposal takes part in every rule). An accepted one moves
  // only on an applied claim of sufficient precedence; anything else is a
  // proposal, never a quiet move.
  if (line.state !== "proposed" && (claim.state !== "applied" || precedenceOf(claim) > stateRank(store, line))) {
    return proposeState(store, claim, line, to, at)
  }
  const next = store.putLine({
    ...line,
    text: claim.statement || line.text,
    payload: { ...line.payload, commitment: to },
    claims: addClaim(line.claims, claim.id),
    updated: at,
  })
  return { action: "transitioned", from, to, line: next }
}

function proposeState(store, claim, line, to, at) {
  const key = `${line.line_key}#s:${claim.claim_key}`
  const existing = store.line(key)
  const proposal = store.putLine({
    line_key: key,
    kind: line.kind,
    type: line.type,
    subject: line.subject,
    attribute: "state",
    text: claim.statement || `Change to ${to}`,
    state: "proposed",
    payload: { commitment: to, from: line.payload?.commitment ?? "open" },
    claims: addClaim(existing?.claims ?? [], claim.id),
    supersedes: line.line_key,
    updated: at,
  })
  return {
    action: "review",
    reason: "a state claim waits for review when it is proposed or below the current precedence",
    line: proposal,
  }
}

function commitmentField(store, claim, line, at) {
  const field = claim.attribute
  const value = canonicalValue(claim.value)
  const held = line.payload?.fields?.[field]
  if (held !== undefined && held === value) {
    return { action: "cited", line: store.putLine({ ...line, claims: addClaim(line.claims, claim.id), updated: at }) }
  }
  const heldRank = line.payload?.precedence?.[field] ?? 4
  if (held !== undefined && (claim.state !== "applied" || precedenceOf(claim) > heldRank)) {
    const key = `${line.line_key}#f:${field}:${claim.claim_key}`
    const existing = store.line(key)
    const proposal = store.putLine({
      line_key: key,
      kind: line.kind,
      type: line.type,
      subject: line.subject,
      attribute: field,
      text: claim.statement || `${field}: ${value}`,
      state: "proposed",
      payload: { field, value },
      claims: addClaim(existing?.claims ?? [], claim.id),
      supersedes: line.line_key,
      updated: at,
    })
    return { action: "review", reason: "a newer value below the current precedence waits for review", line: proposal }
  }
  const next = store.putLine({
    ...line,
    payload: {
      ...line.payload,
      fields: { ...(line.payload?.fields ?? {}), [field]: value },
      precedence: { ...(line.payload?.precedence ?? {}), [field]: precedenceOf(claim) },
    },
    claims: addClaim(line.claims, claim.id),
    updated: at,
  })
  return { action: "upserted", field, from: held ?? null, to: value, line: next }
}

/** The best precedence among the claims that set this commitment's state. */
function stateRank(store, line) {
  let rank = 4
  for (const id of line.claims) {
    const row = store.handle.get("select * from claims where id = ?", id)
    if (!row) continue
    const claim = readClaim(row)
    if (claim.attribute !== "state" && !LIFECYCLE.has(claim.value)) continue
    rank = Math.min(rank, precedenceOf(claim))
  }
  return rank
}

function upsert(store, claim, at, options) {
  const value = canonicalValue(claim.value)
  const key = lineKeyOf(claim.knowledge_key)
  const current = store.line(key)
  if (!current) {
    return {
      action: "appended",
      line: store.putLine({
        line_key: key,
        kind: "memory",
        type: claim.type,
        subject: claim.subject,
        attribute: claim.attribute,
        text: claim.statement,
        state: claim.state === "applied" ? "current" : "proposed",
        payload: { value },
        claims: [claim.id],
        updated: at,
      }),
    }
  }
  const held = current.payload?.value ?? ""
  const pin = store.pinFor(claim.subject, claim.attribute)
  const verdict = supersessionVerdict({ current: { value: held }, incoming: { value }, pin })
  if (verdict.verdict === "none") {
    const state = current.state === "proposed" && claim.state === "applied" ? "current" : current.state
    return { action: "cited", line: store.putLine({ ...current, state, claims: addClaim(current.claims, claim.id), updated: at }) }
  }
  const proposalKey = `${key}#p:${claim.claim_key}`
  const existing = store.line(proposalKey)
  const proposal = store.putLine({
    line_key: proposalKey,
    kind: "memory",
    type: claim.type,
    subject: claim.subject,
    attribute: claim.attribute,
    text: claim.statement,
    state: "proposed",
    payload: { value },
    claims: addClaim(existing?.claims ?? [], claim.id),
    supersedes: key,
    updated: at,
  })
  return {
    action: "review",
    reason: pin ? "the person pinned this attribute, so a change waits for review" : "a supersession waits for review in v1, in every apply mode",
    line: proposal,
    current,
    mode: options.mode ?? "propose",
  }
}

/** Review accepted a supersession: the lineage moves and the new value is current. */
export function applySupersession(store, proposalLineKey, options = {}) {
  const at = (options.now ?? new Date()).toISOString()
  const proposal = store.line(proposalLineKey)
  if (!proposal) throw new ClaimsError("unknown_line", "That proposal is not a projection line.", "Read the line again.")
  if (!proposal.supersedes) throw new ClaimsError("not_a_supersession", "That line supersedes nothing.", "Accept only a supersession proposal.")
  // An accepted claim is applied, so it does not expire as a proposal later.
  const ids = proposal.claims.filter((id) => typeof id === "string")
  if (ids.length > 0) {
    store.handle.run(
      `update claims set state = 'applied' where state = 'proposed' and id in (${ids.map(() => "?").join(", ")})`,
      ...ids,
    )
  }
  const old = store.line(proposal.supersedes)
  if (old) store.putLine({ ...old, state: "superseded", updated: at })
  const line = store.putLine({ ...proposal, state: "current", updated: at })
  return { action: "superseded", line, superseded: old ?? null }
}

/** The projection lines matching a filter, newest first. */
export function linesOf(store, { type, subject, state, limit = 500 } = {}) {
  if (!store) return []
  const where = []
  const params = []
  if (type !== undefined) {
    where.push("type = ?")
    params.push(String(type))
  }
  if (subject !== undefined) {
    where.push("subject = ?")
    params.push(String(subject))
  }
  if (state !== undefined) {
    where.push("state = ?")
    params.push(String(state))
  }
  const sql = `select * from claim_lines ${where.length ? `where ${where.join(" and ")}` : ""} order by updated desc, line_key limit ?`
  return store.handle.all(sql, ...params, Number(limit)).map(readLine)
}

/** A line row with its JSON fields parsed. */
export function readLine(row) {
  return {
    line_key: row.line_key,
    kind: row.kind,
    type: row.type,
    subject: row.subject,
    attribute: row.attribute,
    text: row.text,
    state: row.state,
    payload: parseObject(row.payload),
    claims: parseList(row.claims),
    supersedes: row.supersedes ?? null,
    updated: row.updated,
  }
}

function addClaim(claims, id) {
  return claims.includes(id) ? claims : [...claims, id]
}

function parseList(raw) {
  try {
    const parsed = JSON.parse(raw ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseObject(raw) {
  try {
    const parsed = JSON.parse(raw ?? "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
