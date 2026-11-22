/**
 * The claims log (S2, docs/design/memory-routines-v1.md §4.2). One row per
 * cited statement, in the space's own file. A repeated claim updates its count,
 * its last sighting and its citations in place, so one fact seen twice is one
 * claim.
 *
 * The store takes any handle with `run`, `get`, `all` and `tx`, so a batch can
 * file its claims inside the store's own transaction. Everything is behind
 * `RECORDS_CLAIMS=on`: with the switch off, `openClaims` answers `null` and no
 * file is touched.
 */
import { ulid } from "../ids.js"
import { claimHandle } from "./db.js"
import { ClaimsError } from "./errors.js"
import { claimsEnabled } from "./flag.js"
import { canonicalValue, claimKey as keyOf, forgottenClaimKey, knowledgeKey, rejectionKey } from "./keys.js"
import { CLAIM_TYPES, precedenceOf, typeOf, valueInKey } from "./registry.js"
import { readLine } from "./projections.js"
import { parseList, readClaim } from "./rows.js"
import { hasMark, writeMark } from "./marks.js"
import { forgetClaims } from "./forget.js"
import { authorMap, displayQuote, displayStatement, quoteMap, statementMap } from "./quotes.js"
import { CLAIMS_BUILD } from "./build.js"

/** At most this many citations per claim: the first and the 19 most recent. */
export const MAX_CITATIONS = 20
/** A quote is exact and short. */
export const MAX_QUOTE = 300
const STATES = new Set(["proposed", "applied", "rejected"])

/**
 * @param {{handle: any, env?: Record<string, string | undefined>, now?: () => Date}} input
 * @returns {ClaimsStore | null}
 */
export function openClaims({ handle, env = process.env, now = () => new Date() } = {}) {
  if (!claimsEnabled(env)) return null
  if (!handle) throw new ClaimsError("no_handle", "A claims store needs a space handle.", "Open the space first.")
  return new ClaimsStore({ handle, now, env })
}

export class ClaimsStore {
  #handle
  #now
  #env

  constructor({ handle, now = () => new Date(), env = process.env } = {}) {
    if (!handle) throw new ClaimsError("no_handle", "A claims store needs a space handle.", "Open the space first.")
    this.#handle = handle instanceof Object && typeof handle.tx === "function" ? handle : claimHandle(handle)
    this.#now = now
    this.#env = env
  }

  /** The handle, for the modules that work beside the log (projections, pages, forget). */
  get handle() {
    return this.#handle
  }

  /**
   * File one claim. A repeat of the same claim key updates the row in place and
   * says it was cited, never inserted.
   *
   * @param {object} input a claim (§4.2)
   * @param {{now?: Date}} [options]
   */
  file(input, options = {}) {
    if (!input || typeof input !== "object") throw new ClaimsError("invalid_claim", "A claim is an object.", "Send the claim's fields.")
    const type = String(input.type ?? "")
    typeOf(type)
    const statedBy = String(input.stated_by ?? "")
    if (!statedBy) throw new ClaimsError("invalid_stated_by", "A claim says who stated it.", "Send stated_by as person, other:<id>, source:<name> or derived.")
    const state = String(input.state ?? "proposed")
    if (!STATES.has(state)) {
      throw new ClaimsError("invalid_state", `"${state}" is not a claim state.`, "Send state as proposed or applied.")
    }
    const named = input.knowledge_key ?? input.knowledgeKey
    if (named !== undefined && String(named).trim() === "") {
      throw new ClaimsError("invalid_knowledge", "A claim needs a knowledge key.", "Send knowledge_key, or the fields its type keys on.")
    }
    const knowledge = String(named ?? "").trim() || knowledgeKey(type, input)
    if (!knowledge) throw new ClaimsError("invalid_knowledge", "A claim needs a knowledge key.", "Send knowledge_key, or the fields its type keys on.")
    const value = canonicalValue(input.value)
    const attribute = String(input.attribute ?? "")
    const offered = mergeRefs([], input.refs)
    const subject = String(input.subject ?? "me")
    const liveRefs = offered.filter((ref) => !hasMark(this.#handle, "forgotten-ref", ref))
    const gone =
      (offered.length > 0 && liveRefs.length === 0) ||
      hasMark(this.#handle, "forgotten-subject", subject) ||
      hasMark(this.#handle, "forgotten-stated", statedBy) ||
      hasMark(this.#handle, "forgotten-item", forgottenClaimKey(type, knowledge, value)) ||
      hasMark(this.#handle, "forgotten-author", forgottenClaimKey(type, knowledge, value, statedBy))
    if (gone) {
      return { claim: null, inserted: false, cited: false, suppressed: true, state: "forgotten", claim_key: keyOf(type, knowledge, value, attribute) }
    }
    const claimKey = keyOf(type, knowledge, value, attribute)
    if (this.isRejected({ type, knowledge_key: knowledge, value, attribute })) {
      return { claim: null, inserted: false, cited: false, suppressed: true, state: "rejected", claim_key: claimKey }
    }
    const at = (options.now ?? this.#now()).toISOString()
    // The file says which build wrote its claims, so a later rollback build can
    // refuse to erase a layout it does not know (review M6).
    this.#handle.run(
      "insert into meta (key, value) values ('claims_build', ?) on conflict(key) do update set value = excluded.value",
      CLAIMS_BUILD,
    )
    const fields = {
      type,
      knowledge_key: knowledge,
      subject,
      attribute,
      value,
      statement: String(input.statement ?? ""),
      stated_by: statedBy,
      quote: String(input.quote ?? "").slice(0, MAX_QUOTE),
      source: String(input.source ?? ""),
      version: String(input.version ?? ""),
    }
    const refs = liveRefs
    const existing = this.get(claimKey)
    if (existing) {
      const merged = mergeRefs(existing.refs, refs)
      const kept = new Set(merged)
      const quotes = pruneMap(quoteMap(existing.quotes, refs, fields.quote), kept)
      const statements = pruneMap(statementMap(existing.statements, refs, fields.statement), kept)
      const authors = pruneMap(authorMap(existing.authors, refs, statedBy), kept)
      const sharedQuotes = pruneShared(existing.shared_quotes, fields.quote, refs, quotes)
      const sharedStatements = pruneShared(existing.shared_statements, fields.statement, refs, statements)
      const nextState = existing.state === "applied" ? "applied" : state
      // A lift adds the person's own sighting; it keeps each ref's author, so
      // erasing the original author still removes their words (S2 re-review).
      const stated = strongestAuthor(Object.values(authors)) ?? fields.stated_by
      this.#handle.run(
        "update claims set refs = ?, quotes = ?, statements = ?, shared_quotes = ?, shared_statements = ?, authors = ?, count = count + 1, last_seen = ?, state = ?, stated_by = ?, quote = ?, statement = ? where claim_key = ?",
        JSON.stringify(merged),
        JSON.stringify(quotes),
        JSON.stringify(statements),
        JSON.stringify(sharedQuotes),
        JSON.stringify(sharedStatements),
        JSON.stringify(authors),
        at,
        nextState,
        stated,
        displayQuote(merged, quotes),
        displayStatement(merged, statements),
        claimKey,
      )
      for (const ref of merged) {
        this.#handle.run(
          "insert or replace into claim_refs (claim_id, ref, author) values (?, ?, ?)",
          existing.id,
          ref,
          authors[ref] ?? statedBy,
        )
      }
      for (const row of this.#handle.all("select ref from claim_refs where claim_id = ?", existing.id)) {
        if (!kept.has(row.ref)) this.#handle.run("delete from claim_refs where claim_id = ? and ref = ?", existing.id, row.ref)
      }
      return { claim: this.get(claimKey), inserted: false, cited: true }
    }
    const id = `clm_${ulid()}`
    const quotes = quoteMap({}, refs, fields.quote)
    const statements = statementMap({}, refs, fields.statement)
    const authors = authorMap({}, refs, statedBy)
    const sharedQuotes = refs.length > 1 && fields.quote ? [fields.quote] : []
    const sharedStatements = refs.length > 1 && fields.statement ? [fields.statement] : []
    this.#handle.run(
      `insert into claims (id, claim_key, knowledge_key, type, subject, attribute, value, statement, stated_by,
        quote, quotes, statements, shared_quotes, shared_statements, authors, refs, source, version, state, first_seen, last_seen, count)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      id,
      claimKey,
      fields.knowledge_key,
      fields.type,
      fields.subject,
      fields.attribute,
      fields.value,
      displayStatement(refs, statements) || fields.statement,
      statedBy,
      displayQuote(refs, quotes) || fields.quote,
      JSON.stringify(quotes),
      JSON.stringify(statements),
      JSON.stringify(sharedQuotes),
      JSON.stringify(sharedStatements),
      JSON.stringify(authors),
      JSON.stringify(refs),
      fields.source,
      fields.version,
      state,
      at,
      at,
    )
    for (const ref of refs) {
      this.#handle.run(
        "insert or replace into claim_refs (claim_id, ref, author) values (?, ?, ?)",
        id,
        ref,
        authors[ref] ?? statedBy,
      )
    }
    return { claim: this.get(claimKey), inserted: true, cited: false }
  }

  /** One claim by its claim key, or null. */
  get(claimKey) {
    const row = this.#handle.get("select * from claims where claim_key = ?", String(claimKey))
    return row ? readClaim(row) : null
  }

  /** Claims by knowledge key, newest first. */
  byKnowledge(knowledge) {
    return this.#handle.all("select * from claims where knowledge_key = ? order by last_seen desc", String(knowledge)).map(readClaim)
  }

  /** Claims matching a filter, newest first. */
  all({ type, subject, state, knowledge, limit = 1_000 } = {}) {
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
    if (knowledge !== undefined) {
      where.push("knowledge_key = ?")
      params.push(String(knowledge))
    }
    const sql = `select * from claims ${where.length ? `where ${where.join(" and ")}` : ""} order by last_seen desc limit ?`
    return this.#handle.all(sql, ...params, Number(limit)).map(readClaim)
  }

  /** The attributes this subject already knows, for the `new` rule of §5.3. */
  knownAttributes(subject) {
    return this.#handle
      .all("select distinct attribute from claims where subject = ? and attribute <> '' order by attribute", String(subject))
      .map((row) => row.attribute)
  }

  /** The subjects this space already knows, for the known-or-new rule. */
  knownSubjects() {
    return this.#handle.all("select distinct subject from claims order by subject").map((row) => row.subject)
  }

  /**
   * A person's edit pins its attribute (design §5.3): a later source value that
   * differs is a proposal, never a replacement.
   */
  pin({ subject, attribute, value, by = null }, options = {}) {
    const at = (options.now ?? this.#now()).toISOString()
    this.#handle.run(
      `insert into claim_pins (subject, attribute, value, by_user, at) values (?, ?, ?, ?, ?)
       on conflict(subject, attribute) do update set value = excluded.value, by_user = excluded.by_user, at = excluded.at`,
      String(subject),
      String(attribute),
      canonicalValue(value),
      by === null ? null : String(by),
      at,
    )
    return this.pinFor(subject, attribute)
  }

  /** The pin on one (subject, attribute), or null. */
  pinFor(subject, attribute) {
    const row = this.#handle.get("select * from claim_pins where subject = ? and attribute = ?", String(subject), String(attribute))
    return row ? { subject: row.subject, attribute: row.attribute, value: row.value, by_user: row.by_user ?? null, at: row.at } : null
  }

  /**
   * Remember a rejection against the key (design §4.3): the claim key for an
   * upsert type, the knowledge key for an append type. The mark is a keyed
   * hash, so it holds no text, and it survives a new extractor digest.
   */
  reject(claim, options = {}) {
    const target = this.#rejectionOf(claim)
    if (!target) throw new ClaimsError("invalid_claim", "A rejection names a claim, or its type, knowledge key and value.", "Send the claim's fields.")
    const at = (options.now ?? this.#now()).toISOString()
    const key = writeMark(this.#handle, "rejected", rejectionKey(target.type, target.knowledge_key, target.value, target.attribute), at)
    this.#handle.tx(() => {
      const rows = this.#handle.all("select claim_key, value, state from claims where knowledge_key = ? and type = ?", target.knowledge_key, target.type)
      let rejected = 0
      for (const row of rows) {
        if (valueInKey(target.type) && row.value !== canonicalValue(target.value)) continue
        if (row.state === "rejected") continue
        this.#handle.run("update claims set state = 'rejected' where claim_key = ?", row.claim_key)
        rejected += 1
      }
      const ids = this.#handle
        .all("select id from claims where knowledge_key = ? and type = ? and state = 'rejected'", target.knowledge_key, target.type)
        .map((row) => row.id)
      this.#dropRejectedLines(ids)
      return rejected
    })
    const rejected = this.#handle.all("select claim_key from claims where knowledge_key = ? and type = ? and state = 'rejected'", target.knowledge_key, target.type)
    return { rejected: rejected.length, key }
  }

  /**
   * The forget cascade (design §8.5), so a caller holding the log can run it
   * without reaching for the module: `claims.forget({ refs })`.
   */
  forget(input, options = {}) {
    return forgetClaims(this.#handle, input, { env: this.#env, ...options })
  }

  /** True when this claim's rejection key has a mark. */
  isRejected(claim) {
    const target = this.#rejectionOf(claim)
    if (!target) return false
    return hasMark(this.#handle, "rejected", rejectionKey(target.type, target.knowledge_key, target.value, target.attribute))
  }

  /**
   * The proposals the digest announces before they expire: 90 days after their
   * last sighting, shown once they are within the announcement window.
   */
  dueToExpire({ now, withinDays = 7, days = 90 } = {}) {
    const at = now ?? this.#now()
    const cutoff = new Date(at.getTime() - (days - withinDays) * 86_400_000).toISOString()
    const rows = this.#handle.all("select id, claim_key, type, subject, last_seen from claims where state = 'proposed' and last_seen <= ? order by last_seen", cutoff)
    const byType = {}
    for (const row of rows) byType[row.type] = (byType[row.type] ?? 0) + 1
    return {
      count: rows.length,
      byType,
      claims: rows.map((row) => ({
        id: row.id,
        claim_key: row.claim_key,
        type: row.type,
        subject: row.subject,
        expires: new Date(new Date(row.last_seen).getTime() + days * 86_400_000).toISOString(),
      })),
    }
  }

  /**
   * Delete the proposals past their 90 days. It writes no rejection mark, so a
   * later sighting may propose the same claim again, and it removes the
   * proposal lines that cited only them.
   */
  expireProposals({ now, days = 90, limit = 5_000 } = {}) {
    const at = now ?? this.#now()
    const cutoff = new Date(at.getTime() - days * 86_400_000).toISOString()
    return this.#handle.tx(() => {
      const rows = this.#handle.all(
        "select id, claim_key, type, knowledge_key from claims where state = 'proposed' and last_seen <= ? order by last_seen limit ?",
        cutoff,
        limit,
      )
      if (rows.length === 0) return { expired: 0, claims: [], lines: 0 }
      const ids = new Set(rows.map((row) => row.id))
      let lines = 0
      const protectedIds = new Set()
      for (const line of this.#handle.all("select line_key, state, claims from claim_lines")) {
        let cited = []
        try {
          cited = JSON.parse(line.claims ?? "[]")
        } catch {
          cited = []
        }
        const hits = cited.filter((id) => ids.has(id))
        if (hits.length === 0) continue
        // A proposal line goes only when every claim it cites is expiring. Any
        // other line keeps its claims alive: a claim lives while a projection
        // cites it (design §4.2).
        if (line.state === "proposed" && cited.every((id) => ids.has(id))) {
          this.#handle.run("delete from claim_lines where line_key = ?", line.line_key)
          this.#handle.run("delete from claim_line_cites where line_key = ?", line.line_key)
          lines += 1
          continue
        }
        for (const id of hits) protectedIds.add(id)
      }
      const expiring = rows.filter((row) => !protectedIds.has(row.id))
      for (const row of expiring) {
        this.#handle.run("delete from claims where id = ?", row.id)
        this.#handle.run("delete from claim_refs where claim_id = ?", row.id)
        this.#handle.run("delete from claim_line_cites where claim_id = ?", row.id)
      }
      return { expired: expiring.length, claims: expiring.map((row) => row.claim_key), lines }
    })
  }

  /** A line that cited a rejected claim drops it, so a rejected text never shows. */
  #dropRejectedLines(ids) {
    const rejected = new Set(ids)
    if (rejected.size === 0) return
    for (const line of this.#handle.all("select * from claim_lines")) {
      const cited = parseList(line.claims)
      if (!cited.some((id) => rejected.has(id))) continue
      const remaining = cited.filter((id) => !rejected.has(id))
      const pairs = remaining
        .map((id) => [id, this.#handle.get("select statement, value from claims where id = ?", id)])
        .filter(([, claim]) => claim !== undefined)
      const statements = pairs.map(([, claim]) => claim.statement || claim.value).filter(Boolean)
      if (pairs.length === 0 || statements.length === 0) {
        this.#handle.run("delete from claim_lines where line_key = ?", line.line_key)
        this.#handle.run("delete from claim_line_cites where line_key = ?", line.line_key)
        continue
      }
      this.#handle.run(
        "update claim_lines set claims = ?, text = ?, updated = ? where line_key = ?",
        JSON.stringify(pairs.map(([id]) => id)),
        statements.join("; "),
        this.#now().toISOString(),
        line.line_key,
      )
    }
  }

  #rejectionOf(claim) {
    if (!claim) return null
    if (typeof claim === "string") {
      const row = this.#handle.get("select type, knowledge_key, value, attribute from claims where claim_key = ?", claim)
      return row ? { type: row.type, knowledge_key: row.knowledge_key, value: row.value, attribute: row.attribute } : null
    }
    const type = String(claim.type ?? "")
    const knowledge = String(claim.knowledge_key ?? claim.knowledgeKey ?? "")
    if (!type || !knowledge) return null
    return { type, knowledge_key: knowledge, value: claim.value, attribute: String(claim.attribute ?? "") }
  }

  /** The time this store files at, so a caller can time a projection. */
  now() {
    return this.#now()
  }

  /** One projection line, or null. */
  line(lineKey) {
    const row = this.#handle.get("select * from claim_lines where line_key = ?", String(lineKey))
    return row ? readLine(row) : null
  }

  /** Write a projection line (insert or replace) and read it back. */
  putLine(line) {
    this.#handle.run(
      `insert into claim_lines (line_key, kind, type, subject, attribute, text, state, payload, claims, supersedes, updated)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(line_key) do update set kind = excluded.kind, type = excluded.type, subject = excluded.subject,
         attribute = excluded.attribute, text = excluded.text, state = excluded.state, payload = excluded.payload,
         claims = excluded.claims, supersedes = excluded.supersedes, updated = excluded.updated`,
      String(line.line_key),
      String(line.kind ?? ""),
      String(line.type ?? ""),
      String(line.subject ?? ""),
      String(line.attribute ?? ""),
      String(line.text ?? ""),
      String(line.state ?? "proposed"),
      JSON.stringify(line.payload ?? {}),
      JSON.stringify(Array.isArray(line.claims) ? line.claims : []),
      line.supersedes ?? null,
      String(line.updated ?? this.#now().toISOString()),
    )
    this.#handle.run("delete from claim_line_cites where line_key = ?", String(line.line_key))
    for (const id of Array.isArray(line.claims) ? line.claims : []) {
      this.#handle.run("insert or ignore into claim_line_cites (line_key, claim_id) values (?, ?)", String(line.line_key), String(id))
    }
    return this.line(line.line_key)
  }

  /** How many claims the log holds, by state. */
  counts() {
    const out = { proposed: 0, applied: 0, rejected: 0, total: 0 }
    for (const row of this.#handle.all("select state, count(*) as n from claims group by state")) {
      out[row.state] = Number(row.n)
      out.total += Number(row.n)
    }
    return out
  }

  /** The types this log files, for a caller's check. */
  static types() {
    return CLAIM_TYPES
  }
}

/** A map with only the refs a claim still cites. */
function pruneMap(map, kept) {
  const out = {}
  for (const [ref, value] of Object.entries(map ?? {})) if (kept.has(ref)) out[ref] = value
  return out
}

/** The shared values that still appear, and a new value if its filing had several refs. */
function pruneShared(existing, value, refs, map) {
  const shared = new Set(Array.isArray(existing) ? existing : [])
  if (value && Array.isArray(refs) && refs.length > 1) shared.add(value)
  const present = new Set(Object.values(map))
  return [...shared].filter((item) => present.has(item))
}

/** The best attribution among a claim's authors, or null when none is left. */
function strongestAuthor(values) {
  let best = null
  for (const value of values) {
    if (!value) continue
    if (best === null || precedenceOf({ stated_by: value }) < precedenceOf({ stated_by: best })) best = value
  }
  return best
}

/**
 * Keep the first citation and the 19 most recent (design §4.2, scale M4).
 * A citation seen again moves to the recent end, so it is not dropped as old.
 */
export function mergeRefs(existing, incoming) {
  const refs = [...existing]
  for (const ref of Array.isArray(incoming) ? incoming : []) {
    if (typeof ref !== "string" || !ref) continue
    const seen = refs.indexOf(ref)
    if (seen === 0) continue
    if (seen > 0) refs.splice(seen, 1)
    refs.push(ref)
  }
  if (refs.length <= MAX_CITATIONS) return refs
  const first = refs[0]
  const recent = refs.slice(1).filter((ref) => ref !== first).slice(-(MAX_CITATIONS - 1))
  return [first, ...recent]
}
