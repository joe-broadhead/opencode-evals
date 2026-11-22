/**
 * The shadow sink (design §14; the plan's §3 and decision 5): `engine_shadow`
 * holds what the engine would have filed, and nothing else.
 *
 * In shadow the engine writes **no** projections, **no** proposals and no
 * records: a shadow claim cannot change what a person sees. The row carries the
 * claim's own key, its type and knowledge key, the refs it cited, the lane it was
 * read on, a digest of its statement and when. S8's report reads it; nothing
 * else does.
 */
import { sha256 } from "../ids.js"

/** What one claim leaves in the shadow log. */
export function shadowRow(claim, { lane, at }) {
  return {
    claim_key: String(claim.claim_key ?? ""),
    type: String(claim.type ?? ""),
    knowledge_key: String(claim.knowledge_key ?? ""),
    refs: JSON.stringify(Array.isArray(claim.refs) ? claim.refs : []),
    lane: String(lane ?? ""),
    digest: `sha256:${sha256(String(claim.statement ?? ""))}`.slice(0, 40),
    at,
  }
}

/** Write a batch's claims to the shadow log, on the commit's own transaction. */
export function recordShadow(tx, { claims = [], lane, at }) {
  let written = 0
  for (const claim of claims) {
    const row = shadowRow(claim, { lane, at })
    if (!row.claim_key) continue
    tx.run("insert into engine_shadow (claim_key, type, knowledge_key, refs, lane, digest, at) values (?, ?, ?, ?, ?, ?, ?)", row.claim_key, row.type, row.knowledge_key, row.refs, row.lane, row.digest, row.at)
    written += 1
  }
  return written
}

/** The rows one interval holds, for a status answer or S8's report. */
export function shadowRows(tx, { since = null, limit = 200 } = {}) {
  return since === null
    ? tx.all("select claim_key, type, knowledge_key, refs, lane, digest, at from engine_shadow order by at, claim_key limit ?", Math.max(1, limit))
    : tx.all("select claim_key, type, knowledge_key, refs, lane, digest, at from engine_shadow where at >= ? order by at, claim_key limit ?", since, Math.max(1, limit))
}
