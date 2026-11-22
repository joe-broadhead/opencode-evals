/**
 * The forget cascade through claims (docs/design/memory-routines-v1.md §8.5,
 * S2 item 6 and review M4). It runs without a model call:
 *
 * 1. delete every claim that cites only a forgotten item, and drop the item
 *    from a claim that keeps another citation;
 * 2. remove every projection line that cites a deleted claim, and re-project a
 *    line that keeps citations from the claims that remain; it is never kept
 *    verbatim;
 * 3. purge the older page versions that held a removed line;
 * 4. mark a reduced page for a rebuild;
 * 5. report the journal days to rebuild.
 *
 * A forget larger than one bounded batch is sliced: a pending row holds the
 * input, the forgotten refs and knowledge keys are marked at once so nothing is
 * re-created while it runs, and each slice is its own transaction. Call it again
 * with `{ pendingId }` to resume.
 *
 * This is the small hook `events.forget` calls, inside its own transaction for
 * a small forget: `forgetClaims(handle, { refs, subjects, statedBy, claimIds,
 * pages, tz })`.
 */
import { ulid } from "../ids.js"
import { localDay } from "../routines/dates.js"
import { claimHandle } from "./db.js"
import { claimsEnabled } from "./flag.js"
import { forgottenClaimKey } from "./keys.js"
import { hasMark, writeMark } from "./marks.js"
import { precedenceOf } from "./registry.js"
import { readClaim, parseList } from "./rows.js"
import { displayQuote, displayStatement, keptAttribution, keptAuthors, keptByRef } from "./quotes.js"

/** A slice's bound: claims one transaction removes. */
export const FORGET_BATCH = 200
const MAX_BATCH = 5_000

/**
 * @param {any} handle a store handle, or a node:sqlite database
 * @param {{refs?: string[], subjects?: string[], statedBy?: string[], stated_by?: string[],
 *   claimIds?: string[], pages?: string[], tz?: string, now?: Date, batch?: number,
 *   pendingId?: string}} input
 * @param {{env?: Record<string, string | undefined>}} [options]
 */
export function forgetClaims(handle, input = {}, { env = process.env } = {}) {
  if (!claimsEnabled(env)) return { skipped: "off" }
  const db = claimHandle(handle)
  if (input.pendingId) return resume(db, input)
  const work = normalise(input)
  const at = (input.now ?? new Date()).toISOString()
  const batch = batchOf(input)
  work.batch = batch
  const candidates = candidatePage(db, work, { limit: batch + 1 })
  if (candidates.length <= batch) {
    return db.tx(() => {
      writeInputMarks(db, work, at)
      writeClaimMarks(db, candidates, work, at)
      return { ...remove(db, work, candidates, at), pending: false, remaining: 0, pendingId: null }
    })
  }
  // The pending row and the ref marks commit first, so a re-creation is blocked
  // before any claim is removed. Knowledge-key marks follow in bounded slices.
  const pendingId = `forg_${ulid()}`
  db.tx(() => {
    db.run(
      "insert into claim_forget_pending (id, input, created, updated, remaining) values (?, ?, ?, ?, 0)",
      pendingId,
      JSON.stringify(raw(work)),
      at,
      at,
    )
    writeInputMarks(db, work, at)
  })
  return finishSlice(db, work, pendingId, at, batch)
}

function resume(db, input) {
  const row = db.get("select * from claim_forget_pending where id = ?", String(input.pendingId))
  if (!row) {
    return { pending: false, remaining: 0, claims: 0, lines: 0, reprojected: 0, rebuilds: 0, versions: 0, journalDays: [], model_calls: 0 }
  }
  const work = normalise(JSON.parse(row.input))
  const at = (input.now ?? new Date()).toISOString()
  return finishSlice(db, work, row.id, at, batchOf({ batch: work.batch }))
}

/** One bounded slice, its own transaction, and the pending row's new state. */
function finishSlice(db, work, pendingId, at, batch) {
  const slice = candidatePage(db, work, { limit: batch })
  const result = db.tx(() => {
    writeClaimMarks(db, slice, work, at)
    return remove(db, work, slice, at)
  })
  const remaining = candidateCount(db, work)
  const pending = remaining > 0
  if (!pending) db.run("delete from claim_forget_pending where id = ?", pendingId)
  else db.run("update claim_forget_pending set remaining = ?, updated = ? where id = ?", remaining, at, pendingId)
  return { ...result, pending, remaining, pendingId: pending ? pendingId : null }
}

/** The refs of a claim that a forget removes: the item's, and the person's own. */
function goneRefsOf(claim, work) {
  const gone = new Set()
  for (const ref of claim.refs) {
    if (work.refs.has(ref)) gone.add(ref)
    const author = claim.authors?.[ref] ?? claim.stated_by
    if (work.statedBy.has(author)) gone.add(ref)
  }
  return gone
}

/**
 * What a forget does to one claim: delete it, or keep the refs it still has a
 * statement from. A claim with no live statement is deleted, so no forgotten
 * words remain (S2 re-review, H1).
 */
function planClaim(claim, work) {
  if (work.named.has(claim.id) || work.subjects.has(claim.subject)) return { delete: true }
  const gone = goneRefsOf(claim, work)
  const keep = claim.refs.filter((ref) => !gone.has(ref))
  if (keep.length === 0) return { delete: true }
  const statements = ensureAttribution({ ...(claim.statements ?? {}) }, claim.refs, claim.statement)
  const quotes = ensureAttribution({ ...(claim.quotes ?? {}) }, claim.refs, claim.quote)
  const keptStatements = pruneSharedValues(statements, keep, gone, claim.shared_statements)
  const keptQuotes = pruneSharedValues(quotes, keep, gone, claim.shared_quotes)
  const keptAuthorMap = keptAuthors(keep, gone, claim.authors)
  const stated = strongestAuthor(Object.values(keptAuthorMap))
  if (!stated && work.statedBy.has(claim.stated_by)) return { delete: true }
  return {
    delete: false,
    refs: keep,
    quotes: keptQuotes,
    statements: keptStatements,
    shared_quotes: (claim.shared_quotes ?? []).filter((value) => Object.values(keptQuotes).includes(value)),
    shared_statements: (claim.shared_statements ?? []).filter((value) => Object.values(keptStatements).includes(value)),
    authors: keptAuthorMap,
    quote: displayQuote(keep, keptQuotes),
    statement: displayStatement(keep, keptStatements),
    stated_by: stated ?? claim.stated_by,
  }
}

/**
 * The words a claim keeps: a shared value (from a filing with several refs) goes
 * when any ref that held it is forgotten; an unshared value goes only with its
 * own ref. A live ref that never held the words is not affected.
 */
function pruneSharedValues(map, keep, gone, shared) {
  const sharedSet = new Set(Array.isArray(shared) ? shared : [])
  const goneValues = new Set()
  for (const ref of gone) {
    const value = map?.[ref]
    if (value !== undefined && sharedSet.has(value)) goneValues.add(value)
  }
  const out = {}
  for (const ref of keep) {
    const value = map?.[ref]
    if (value === undefined || goneValues.has(value)) continue
    out[ref] = value
  }
  return out
}

function ensureAttribution(map, refs, text) {
  if (Object.keys(map).length > 0 || !text || refs.length === 0) return map
  return { [refs[0]]: text }
}

function strongestAuthor(values) {
  let best = null
  for (const value of values) {
    if (!value) continue
    if (best === null || precedenceOf({ stated_by: value }) < precedenceOf({ stated_by: best })) best = value
  }
  return best
}

/**
 * One page of the claims this input still touches, read by index: the refs in
 * `claim_refs`, the subject and legacy author on `claims`, and the authors in
 * `claim_refs`, after the last id on the previous page (S2 re-review, M4).
 */
function candidatePage(db, work, { after = "", limit = 200 } = {}) {
  const where = whereClause(work)
  if (!where) return []
  const sql = `select c.* from claims c where (${where.sql}) and c.id > ? order by c.id limit ?`
  return db.all(sql, ...where.params, String(after ?? ""), Number(limit)).map(readClaim)
}

function candidateCount(db, work) {
  const where = whereClause(work)
  if (!where) return 0
  return Number(db.get(`select count(*) as n from claims c where (${where.sql})`, ...where.params).n)
}

function whereClause(work) {
  const clauses = []
  const params = []
  if (work.refs.size > 0) {
    clauses.push(`c.id in (select claim_id from claim_refs where ref in (${marks(work.refs.size)}))`)
    params.push(...work.refs)
  }
  if (work.subjects.size > 0) {
    clauses.push(`c.subject in (${marks(work.subjects.size)})`)
    params.push(...work.subjects)
  }
  if (work.named.size > 0) {
    clauses.push(`c.id in (${marks(work.named.size)})`)
    params.push(...work.named)
  }
  if (work.statedBy.size > 0) {
    clauses.push(`c.stated_by in (${marks(work.statedBy.size)})`)
    params.push(...work.statedBy)
    clauses.push(`c.id in (select claim_id from claim_refs where author in (${marks(work.statedBy.size)}))`)
    params.push(...work.statedBy)
  }
  if (clauses.length === 0) return null
  return { sql: clauses.join(" or "), params }
}

function marks(n) {
  return Array.from({ length: n }, () => "?").join(", ")
}

/** Remove or trim the claims of one slice, and everything that cites them. */
function remove(db, work, slice, at) {
  const doomed = new Set()
  const doomedClaims = []
  const trimmed = new Set()
  for (const claim of slice) {
    const plan = planClaim(claim, work)
    if (plan.delete) {
      doomed.add(claim.id)
      doomedClaims.push(claim)
      continue
    }
    trimmed.add(claim.id)
    db.run(
      "update claims set refs = ?, quotes = ?, statements = ?, shared_quotes = ?, shared_statements = ?, authors = ?, quote = ?, statement = ?, stated_by = ?, last_seen = ? where id = ?",
      JSON.stringify(plan.refs),
      JSON.stringify(plan.quotes),
      JSON.stringify(plan.statements),
      JSON.stringify(plan.shared_quotes),
      JSON.stringify(plan.shared_statements),
      JSON.stringify(plan.authors),
      plan.quote,
      plan.statement,
      plan.stated_by,
      at,
      claim.id,
    )
  }
  for (const claim of slice) {
    if (!trimmed.has(claim.id)) continue
    for (const ref of claim.refs) {
      if (goneRefsOf(claim, work).has(ref)) db.run("delete from claim_refs where claim_id = ? and ref = ?", claim.id, ref)
    }
  }
  for (const id of doomed) {
    db.run("delete from claims where id = ?", id)
    db.run("delete from claim_refs where claim_id = ?", id)
  }

  const touched = [...doomed, ...trimmed]
  const lineKeys = new Set()
  for (const claimId of touched) {
    for (const row of db.all("select line_key from claim_line_cites where claim_id = ?", claimId)) lineKeys.add(row.line_key)
  }
  for (const id of doomed) db.run("delete from claim_line_cites where claim_id = ?", id)

  const removedTexts = []
  let lines = 0
  let reprojected = 0
  let rebuilds = 0
  for (const lineKey of lineKeys) {
    const row = db.get("select * from claim_lines where line_key = ?", lineKey)
    if (!row) continue
    const cited = parseList(row.claims)
    if (row.kind === "reduced" || row.type === "voice") {
      writeMark(db, "rebuild", row.subject || row.line_key, at)
      rebuilds += 1
    }
    const remaining = cited.filter((id) => !doomed.has(id))
    if (row.text) removedTexts.push(String(row.text))
    if (remaining.length === 0) {
      db.run("delete from claim_lines where line_key = ?", row.line_key)
      db.run("delete from claim_line_cites where line_key = ?", row.line_key)
      lines += 1
      continue
    }
    const found = remaining
      .map((id) => [id, db.get("select statement, value from claims where id = ?", id)])
      .filter(([, claim]) => claim !== undefined)
    const statements = found.map(([, claim]) => claim.statement || claim.value).filter(Boolean)
    // A line with no live claim left is a line this forget removed, never a
    // line to keep from its own old text.
    if (found.length === 0 || statements.length === 0) {
      db.run("delete from claim_lines where line_key = ?", row.line_key)
      db.run("delete from claim_line_cites where line_key = ?", row.line_key)
      lines += 1
      continue
    }
    db.run(
      "update claim_lines set claims = ?, text = ?, updated = ? where line_key = ?",
      JSON.stringify(found.map(([id]) => id)),
      statements.join("; "),
      at,
      row.line_key,
    )
    db.run("delete from claim_line_cites where line_key = ?", row.line_key)
    for (const [id] of found) db.run("insert or ignore into claim_line_cites (line_key, claim_id) values (?, ?)", row.line_key, id)
    reprojected += 1
  }

  let versions = 0
  for (const recordId of work.pages) {
    for (const row of db.all("select version, snapshot from versions where record_id = ?", String(recordId))) {
      if (!removedTexts.some((text) => text && snapshotHolds(row.snapshot, text))) continue
      db.run("delete from versions where record_id = ? and version = ?", String(recordId), row.version)
      versions += 1
    }
  }

  const days = new Set()
  for (const claim of slice) {
    for (const ref of claim.refs) {
      if (!work.refs.has(ref)) continue
      const event = db.get("select occurred_at from events where id = ?", ref)
      if (event?.occurred_at) days.add(localDay(event.occurred_at, work.tz))
    }
  }
  return {
    claims: doomed.size,
    lines,
    reprojected,
    rebuilds,
    versions,
    journalDays: [...days].sort(),
    model_calls: 0,
  }
}

/** Mark the input's own keys at once, so nothing is re-created while a forget runs. */
/**
 * The marks one claim leaves. Forgetting an item is content-scoped: its words
 * must not return from any source or author. Erasing a person is
 * author-scoped: their statements stop, and the owner's own later statement of
 * the same thing still files (S2 fourth review).
 */
function writeClaimMarks(db, claims, work, at) {
  for (const claim of claims) {
    const gone = goneRefsOf(claim, work)
    const refs = gone.size > 0 ? [...gone] : claim.refs
    let item = work.named.has(claim.id) || work.subjects.has(claim.subject) || gone.size === 0
    const authors = new Set()
    for (const ref of refs) {
      const author = claim.authors?.[ref] ?? claim.stated_by
      if (work.refs.has(ref)) item = true
      if (work.statedBy.has(author)) authors.add(author)
    }
    if (item) writeMark(db, "forgotten-item", forgottenClaimKey(claim.type, claim.knowledge_key, claim.value), at)
    for (const author of authors) {
      writeMark(db, "forgotten-author", forgottenClaimKey(claim.type, claim.knowledge_key, claim.value, author), at)
    }
  }
}

function writeInputMarks(db, work, at) {
  for (const ref of work.refs) writeMark(db, "forgotten-ref", ref, at)
  for (const subject of work.subjects) writeMark(db, "forgotten-subject", subject, at)
  for (const statedBy of work.statedBy) writeMark(db, "forgotten-stated", statedBy, at)
}

function normalise(input) {
  return {
    refs: new Set(Array.isArray(input.refs) ? input.refs : []),
    subjects: new Set(Array.isArray(input.subjects) ? input.subjects : []),
    statedBy: new Set([...(input.statedBy ?? []), ...(input.stated_by ?? [])]),
    named: new Set(Array.isArray(input.claimIds) ? input.claimIds : []),
    pages: Array.isArray(input.pages) ? input.pages : [],
    tz: input.tz ?? "UTC",
    batch: input.batch,
  }
}

function raw(work) {
  return {
    refs: [...work.refs],
    subjects: [...work.subjects],
    statedBy: [...work.statedBy],
    claimIds: [...work.named],
    pages: work.pages,
    tz: work.tz,
    batch: work.batch,
  }
}

function batchOf(input) {
  const value = Number(input.batch ?? FORGET_BATCH)
  if (!Number.isInteger(value) || value < 1) return FORGET_BATCH
  return Math.min(value, MAX_BATCH)
}

function chunks(list, size) {
  const out = []
  for (let index = 0; index < list.length; index += size) out.push(list.slice(index, index + size))
  return out
}

/**
 * True when a snapshot holds the text in one of its values. The version's
 * snapshot is JSON, so a quote inside the text is escaped there: a substring
 * search on the serialised row would miss it (review M3).
 */
export function snapshotHolds(snapshot, text) {
  if (typeof text !== "string" || text === "") return false
  let parsed
  try {
    parsed = JSON.parse(snapshot)
  } catch {
    return false
  }
  const walk = (value) => {
    if (typeof value === "string") return value.includes(text)
    if (Array.isArray(value)) return value.some(walk)
    if (value && typeof value === "object") return Object.values(value).some(walk)
    return false
  }
  return walk(parsed)
}

/** True when a reduced page is marked for a rebuild after a forget. */
export function needsRebuild(handle, subject) {
  return hasMark(claimHandle(handle), "rebuild", String(subject))
}

/**
 * Drain a forget to the end, yielding to the event loop between slices. The
 * pending row holds its place, so a long forget never blocks requests
 * (S2 third review, M4).
 */
export async function drainForget(handle, input = {}, { env = process.env, yieldTo } = {}) {
  if (!claimsEnabled(env)) return { skipped: "off" }
  const pause = typeof yieldTo === "function" ? yieldTo : () => new Promise((resolve) => setImmediate(resolve))
  let result = forgetClaims(handle, input, { env })
  while (result.pending) {
    await pause()
    result = forgetClaims(handle, { pendingId: result.pendingId }, { env })
  }
  return result
}

/** The forgets still waiting for slices, for health and the next tick. */
export function pendingForgets(handle) {
  return claimHandle(handle)
    .all("select id, created, updated, remaining from claim_forget_pending order by created")
    .map((row) => ({ id: row.id, created: row.created, updated: row.updated, remaining: Number(row.remaining) }))
}
