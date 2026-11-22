/**
 * An in-memory SpaceStore double with the contract's semantics
 * (memory-v1-contracts.md §2.3–§2.5), for the routines' tests and the
 * evaluation suite until lane REC's `store.js` is wired in. It implements the
 * methods the routines call, plus `ingestEvents`, `bindSource` and
 * `decideProposal` so fixtures can be loaded and review can be exercised.
 *
 * Spaces are keyed by the control space id, never the container (legacy
 * personal spaces share a container). The first write records the space's
 * `meta`: `team` (its container), `space_kind`, and for a personal space
 * `owner_user` (never the routines' own user).
 *
 * Methods the routines need beyond §2.5, asked of lane REC:
 * - `meta()` → `{space, team, space_kind, owner_user}`;
 * - `putRun({run})` (upsert by `run.id`) and `listRuns({routine?, date?,
 *   budget_day?, status?, limit?})` (newest first): the routine ledger and the
 *   per-day token budget, kept inside the space.
 */
import { createHash, randomBytes } from "node:crypto"

export class StoreError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message)
    this.name = "StoreError"
    this.status = status
    this.code = code
    Object.assign(this, extra)
  }
}

const KINDS = {
  memory: new Set(["fact", "preference", "constraint", "decision", "procedure"]),
  page: new Set(["person", "project", "team", "topic", "runbook", "decision", "glossary", "journal", "index", "meeting"]),
  commitment: new Set(["commitment"]),
  proposal: new Set(["create", "append", "supersede", "merge", "close_commitment", "open_commitment", "share"]),
}
const STATUSES = new Set(["current", "superseded", "retired", "contested", "proposed", "accepted", "rejected"])
const PATH = /^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63}){0,3}$/
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
const WRITE_ROLES = new Set(["editor", "admin", "owner"])
const READ_ROLES = new Set(["viewer", "editor", "admin", "owner"])

// The service applies the plugin's curation again on a memory write (§2.4).
const REFUSE = [
  [/\b(?:ignore|disregard) (?:(?:all|any|the|your) )*(?:(?:previous|prior|above|earlier|other) )?(?:instructions|rules|directions)\b/i, "instruction"],
  [/\b(?:you are|you're) now\b/i, "instruction"],
  [/\b(?:when|if|once|after) you (?:read|see|recall|retrieve|load) (?:this|these)\b/i, "instruction"],
  [/\bnot yet (?:confirmed|decided|done|started|finished)\b|\bwork in progress\b|\bnext (?:action|step)s?\s*:/i, "status"],
  [/[\w.+-]+@[\w-]+\.[\w.]{2,}/, "email address"],
  [/(?:^|\s)\/(?:Users|home|private\/var)\/[A-Za-z0-9._-]+\//, "local path"],
]

function ulid(ms) {
  let time = ""
  let t = ms
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = randomBytes(16)
  let rand = ""
  for (let i = 0; i < 16; i += 1) rand += CROCKFORD[bytes[i] % 32]
  return time + rand
}

const clone = (v) => (v === undefined ? undefined : structuredClone(v))

export function linksOf(body, fields) {
  const out = new Set()
  for (const m of String(body ?? "").matchAll(/\[\[([^\]|]{1,200})(?:\|[^\]]{0,200})?\]\]/g)) out.add(m[1].trim())
  for (const l of Array.isArray(fields?.links) ? fields.links : []) out.add(String(l))
  return [...out]
}

function tokens(text) {
  return String(text ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_]+/)
    .filter((t) => t.length > 1)
}

function canRead(actor) {
  return READ_ROLES.has(actor?.role) || actor?.role === "grant"
}

function grantCovers(actor, path, need) {
  if (actor?.role !== "grant" || !path) return false
  const grants = Array.isArray(actor.grants) ? actor.grants : []
  return grants.some((g) => (path === g.prefix || path.startsWith(`${g.prefix}/`)) && (need === "viewer" || g.role === "editor"))
}

function visible(actor, record) {
  if (READ_ROLES.has(actor?.role)) return true
  return grantCovers(actor, record.path, "viewer")
}

function requireRead(actor) {
  if (!canRead(actor)) throw new StoreError(403, "forbidden", "Reading this space needs viewer access.")
}

function requireWrite(actor, path) {
  if (WRITE_ROLES.has(actor?.role)) return
  if (grantCovers(actor, path, "editor")) return
  throw new StoreError(403, "forbidden", "Writing here needs editor access.")
}

function statusFilter(status) {
  if (status === "all") return () => true
  if (status && STATUSES.has(status)) return (r) => r.status === status
  return (r) => r.status === "current" || r.status === "contested"
}

export const ROUTINE_USERS = new Set(["routines"])

function createSpace(spaceId, clock) {
  const records = new Map()
  const versions = new Map()
  const events = new Map()
  const sources = new Map()
  const runs = new Map()
  /** Read marks: `day` → Map(key → fingerprint), as `unit_reads` in the service. */
  const reads = new Map()
  /** The trait gate's verdicts: `day` → Map(key → verdict), as `trait_reads` in the service. */
  const traitVerdicts = new Map()
  let seq = 0
  const meta = { space: spaceId, team: null, space_kind: null, owner_user: null, service: null }

  /** The first write records where the space lives and, if personal, whose it is. */
  function noteMeta(actor) {
    if (!meta.team && actor?.team) meta.team = String(actor.team)
    if (!meta.space_kind && ["personal", "shared"].includes(actor?.spaceKind)) meta.space_kind = actor.spaceKind
    if (meta.space_kind === "personal" && !meta.owner_user && actor?.user && !ROUTINE_USERS.has(actor.user)) meta.owner_user = String(actor.user)
    if (actor?.service) meta.service = String(actor.service)
  }

  const nowIso = () => clock().toISOString()
  const byPath = (path) => [...records.values()].find((r) => r.path === path) ?? null

  function validate(record) {
    if (!KINDS[record.kind]) throw new StoreError(400, "invalid_kind", `Unknown kind ${record.kind}.`)
    if (!KINDS[record.kind].has(record.type)) throw new StoreError(400, "invalid_type", `Type ${record.type} is not valid for ${record.kind}.`)
    if (record.kind === "page") {
      if (!record.path || !PATH.test(record.path)) throw new StoreError(400, "invalid_path", `A page needs a valid path; got ${record.path}.`)
    } else if (record.path) {
      throw new StoreError(400, "invalid_path", "Only pages have a path.")
    }
    if (!STATUSES.has(record.status)) throw new StoreError(400, "invalid_status", `Unknown status ${record.status}.`)
    if (record.kind === "memory") {
      for (const [pattern, why] of REFUSE) {
        if (pattern.test(`${record.title ?? ""}\n${record.body ?? ""}`)) throw new StoreError(422, "refused", `not stored: ${why}`)
      }
    }
  }

  function save(record, previous) {
    if (previous) {
      const list = versions.get(record.id) ?? []
      list.push(clone(previous))
      versions.set(record.id, list)
    }
    record.links = linksOf(record.body, record.fields)
    records.set(record.id, record)
    return clone(record)
  }

  function create(input, actor) {
    const at = nowIso()
    seq += 1
    const record = {
      id: `rec_${ulid(clock().getTime() + seq)}`,
      kind: input.kind,
      type: input.type,
      path: input.path ?? null,
      title: String(input.title ?? "").slice(0, 300),
      body: String(input.body ?? ""),
      status: input.status ?? (input.kind === "proposal" ? "proposed" : "current"),
      stated_by: input.stated_by ?? "agent",
      fields: clone(input.fields ?? {}),
      supersedes: clone(input.supersedes ?? []),
      superseded_by: null,
      source: clone(input.source ?? {}),
      task: input.task ?? null,
      author: { user: actor?.user ?? null, agent: actor?.agent ?? null },
      owner: input.owner ?? actor?.user ?? null,
      created: at,
      updated: at,
      version: 1,
      links: [],
    }
    validate(record)
    if (record.path && byPath(record.path)) throw new StoreError(409, "path_taken", `A page already lives at ${record.path}.`)
    return save(record, null)
  }

  function update(current, input, actor) {
    const next = {
      ...clone(current),
      ...Object.fromEntries(
        ["title", "body", "status", "stated_by", "fields", "supersedes", "source", "task", "owner", "path", "type"]
          .filter((k) => input[k] !== undefined)
          .map((k) => [k, clone(input[k])]),
      ),
      author: { user: actor?.user ?? null, agent: actor?.agent ?? null },
      updated: nowIso(),
      version: current.version + 1,
    }
    validate(next)
    if (next.path !== current.path && next.path && byPath(next.path)) throw new StoreError(409, "path_taken", `A page already lives at ${next.path}.`)
    return save(next, current)
  }

  // Forget tombstones (FABLE records #2), as the real store keeps them.
  const tombstones = new Set()
  // The trait gate's holds (design §5.4): key → the claim as the routine read it.
  const traitHolds = new Map()

  const space = {
    spaceId,

    /** Internal to routines: what may not be written back (tombstones only; no fingerprints here). */
    async routineCheck({ items = [] } = {}) {
      const blocked = []
      items.forEach((item, index) => {
        if (item?.key && tombstones.has(`key:${item.key}`)) blocked.push({ index, why: "tombstone" })
        else if ((item?.refs ?? []).some((ref) => tombstones.has(`ref:${ref}`))) blocked.push({ index, why: "forgotten_ref" })
      })
      return { exists: true, blocked }
    },

    async meta() {
      return { ...meta }
    },

    /** The trait gate's holds, as the real store keeps them: keyed by the claim. */
    async holdTraits({ holds = [] } = {}, actor) {
      requireWrite(actor)
      let held = 0
      let reaped = 0
      for (const [key, hold] of [...traitHolds]) {
        if (hold.ref && events.has(hold.ref)) continue
        traitHolds.delete(key)
        reaped += 1
      }
      for (const hold of holds.slice(0, 2_000)) {
        if (!hold?.key || typeof hold.item !== "string") continue
        const current = traitHolds.get(hold.key)
        const attempted = hold.attempted === true
        traitHolds.set(hold.key, {
          key: hold.key,
          ref: hold.ref ?? null,
          item: hold.item,
          refs: hold.refs ?? current?.refs ?? null,
          reason: String(hold.reason ?? ""),
          attempts: (current?.attempts ?? 0) + (attempted ? 1 : 0),
          attempted: attempted ? nowIso() : current?.attempted ?? null,
          created: current?.created ?? nowIso(),
        })
        held += 1
      }
      return { held, reaped }
    },

    async listTraitHolds({ limit = 200 } = {}, actor) {
      requireRead(actor)
      const list = [...traitHolds.values()].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.key < b.key ? -1 : 1))
      return { holds: clone(list.slice(0, Math.max(1, Math.min(Number(limit) || 200, 2_000)))), total: list.length }
    },

    async releaseTraits({ keys = [] } = {}, actor) {
      requireWrite(actor)
      let released = 0
      for (const key of keys) if (traitHolds.delete(key)) released += 1
      return { released }
    },

    async put({ record, upsert_path: upsertPath } = {}, actor) {
      if (!record || typeof record !== "object") throw new StoreError(400, "invalid_record", "Send a record.")
      requireWrite(actor, record.path)
      noteMeta(actor)
      // The real store refuses a system write whose routine key a person forgot
      // (a tombstone, FABLE records #2); the double keeps the same refusal so a
      // routine meets it in tests.
      if (!record.id && record.fields?.routine_key && tombstones.has(`key:${record.fields.routine_key}`)) {
        throw new StoreError(409, "forgotten", "Not written: a person forgot this (tombstone).")
      }
      if (record.id) {
        const current = records.get(record.id)
        if (!current) throw new StoreError(404, "not_found", `No record ${record.id}.`)
        if (record.base_version !== current.version) {
          throw new StoreError(409, "version_conflict", "The record changed since it was read.", { current: clone(current) })
        }
        return { record: update(current, record, actor), created: false }
      }
      if (upsertPath && record.path) {
        const current = byPath(record.path)
        if (current) return { record: update(current, record, actor), created: false }
      }
      return { record: create(record, actor), created: true }
    },

    async get({ ids = [], paths = [] } = {}, actor) {
      requireRead(actor)
      if (ids.length + paths.length > 50) throw new StoreError(400, "invalid_request", "At most 50 ids and paths.")
      const out = []
      const missing = []
      for (const id of ids) {
        const r = records.get(id)
        if (r && visible(actor, r)) out.push(clone(r))
        else missing.push(id)
      }
      for (const path of paths) {
        const r = byPath(path)
        if (r && visible(actor, r)) out.push(clone(r))
        else missing.push(path)
      }
      return { records: out, missing }
    },

    async list({ kind, type, status, path_prefix: prefix, updated_after: after, limit = 50, cursor, full } = {}, actor) {
      requireRead(actor)
      const keep = statusFilter(status)
      const all = [...records.values()]
        .filter((r) => visible(actor, r))
        .filter((r) => (!kind || r.kind === kind) && (!type || r.type === type) && keep(r))
        .filter((r) => !prefix || (r.path && (r.path === prefix || r.path.startsWith(prefix.endsWith("/") ? prefix : `${prefix}/`) || r.path.startsWith(prefix))))
        .filter((r) => !after || r.updated > after)
        .sort((a, b) => (b.updated === a.updated ? (a.id < b.id ? 1 : -1) : b.updated < a.updated ? -1 : 1))
      const start = Number(cursor ?? 0) || 0
      const n = Math.max(1, Math.min(Number(limit) || 50, 200))
      const page = all.slice(start, start + n).map((r) => {
        const c = clone(r)
        if (!full && c.body.length > 500) c.body = c.body.slice(0, 500)
        return c
      })
      return { records: page, cursor: start + n < all.length ? String(start + n) : null }
    },

    async search({ query, kinds, types, status, path_prefix: prefix, limit = 10 } = {}, actor) {
      requireRead(actor)
      const want = [...new Set(tokens(query))]
      if (want.length === 0) return { hits: [] }
      const keep = status === "all" ? () => true : statusFilter(undefined)
      const hits = []
      for (const r of records.values()) {
        if (!visible(actor, r) || !keep(r)) continue
        if (kinds && !kinds.includes(r.kind)) continue
        if (types && !types.includes(r.type)) continue
        if (prefix && !(r.path ?? "").startsWith(prefix)) continue
        const have = new Set(tokens(`${r.title} ${r.body}`))
        const matched = want.filter((t) => have.has(t)).length
        if (matched === 0) continue
        hits.push({
          id: r.id,
          kind: r.kind,
          type: r.type,
          path: r.path,
          title: r.title,
          status: r.status,
          updated: r.updated,
          score: matched / want.length,
          snippet: r.body.slice(0, 240),
          links: [...r.links],
        })
      }
      hits.sort((a, b) => b.score - a.score || (b.updated < a.updated ? -1 : 1))
      return { hits: hits.slice(0, Math.max(1, Math.min(Number(limit) || 10, 50))) }
    },

    async revise({ id, action, body, title, reason } = {}, actor) {
      const current = records.get(id)
      if (!current) throw new StoreError(404, "not_found", `No record ${id}.`)
      requireWrite(actor, current.path)
      const statusFor = { confirm: "current", retire: "retired", restore: "current", contest: "contested" }
      if (action === "correct") {
        const created = create({ ...current, body: body ?? current.body, title: title ?? current.title, supersedes: [id], status: "current" }, actor)
        const old = update(current, { status: "superseded" }, actor)
        records.get(old.id).superseded_by = created.id
        return { record: created, superseded: clone(records.get(old.id)) }
      }
      if (!statusFor[action]) throw new StoreError(400, "invalid_action", `Unknown action ${action}.`)
      const fields = action === "confirm" ? { ...current.fields, confirmed_at: nowIso() } : current.fields
      return { record: update(current, { status: statusFor[action], fields, ...(reason ? {} : {}) }, actor) }
    },

    async append({ path, section, text } = {}, actor) {
      requireWrite(actor, path)
      const current = byPath(path)
      if (!current) throw new StoreError(404, "not_found", `No page at ${path}.`)
      const lines = current.body.split("\n")
      const heading = `## ${section}`
      let at = lines.findIndex((l) => l.trim() === heading)
      const line = String(text).replace(/[\r\n]+/g, " ")
      if (at === -1) {
        while (lines.length && lines[lines.length - 1].trim() === "") lines.pop()
        lines.push("", heading, line)
      } else {
        let end = at + 1
        while (end < lines.length && !/^#{1,2} /.test(lines[end])) end += 1
        let insert = end
        while (insert > at + 1 && lines[insert - 1].trim() === "") insert -= 1
        lines.splice(insert, 0, line)
      }
      return { record: update(current, { body: lines.join("\n") }, actor) }
    },

    async delete({ ids = [] } = {}, actor) {
      let deleted = 0
      for (const id of ids) {
        const r = records.get(id)
        if (!r) continue
        requireWrite(actor, r.path)
        if (r.author?.user !== actor?.user && !["admin", "owner"].includes(actor?.role)) throw new StoreError(403, "forbidden", "Deleting someone else's record needs admin.")
        if (r.fields?.routine_key) tombstones.add(`key:${r.fields.routine_key}`)
        if (r.kind === "memory" || r.kind === "commitment") for (const ref of [r.source?.turn, r.source?.event]) if (ref) tombstones.add(`ref:${ref}`)
        records.delete(id)
        versions.delete(id)
        deleted += 1
      }
      return { deleted, links_removed: 0 }
    },

    async history({ id } = {}, actor) {
      requireRead(actor)
      const r = records.get(id)
      if (!r) throw new StoreError(404, "not_found", `No record ${id}.`)
      return { versions: clone(versions.get(id) ?? []), lineage: { supersedes: [...r.supersedes], superseded_by: r.superseded_by } }
    },

    async backlinks({ path } = {}, actor) {
      requireRead(actor)
      return { records: [...records.values()].filter((r) => visible(actor, r) && r.links.includes(path)).map(clone) }
    },

    async ingestEvents({ source, account = "default", owner, events: batch = [], cursor } = {}, actor) {
      requireWrite(actor)
      noteMeta(actor)
      const key = `${source}:${account}`
      const bound = sources.get(key)
      if (bound && owner && bound.owner_id !== owner.id) {
        throw new StoreError(409, "source_unbound", `The ${source} account is bound to ${bound.owner_label}.`)
      }
      let accepted = 0
      let duplicates = 0
      for (const e of batch) {
        const id = eventId(source, account, e.external_id)
        if (events.has(id)) {
          duplicates += 1
          continue
        }
        events.set(id, { ...clone(e), id, source, account, text: String(e.text ?? "").slice(0, 4096), ingested_at: nowIso() })
        accepted += 1
      }
      if (bound) Object.assign(bound, { cursor: cursor ?? bound.cursor, cursor_at: nowIso() })
      return { accepted, duplicates, refused: 0, cursor_saved: Boolean(bound) }
    },

    /**
     * The session's curator (DESIGN §15.1, B8): the double keeps no sessions_seen
     * rows, so every session is unowned and both sides are curated as before.
     */
    async sessionsOwner() {
      return { owners: {} }
    },

    /** The latest arrival per UTC day of occurrence, as `ingestMarks`. */
    async ingestMarks({ since, until } = {}, actor) {
      if (!["owner", "admin"].includes(actor?.role)) throw new StoreError(403, "forbidden", "Events are read by the space's owner only.")
      const marks = new Map()
      for (const e of events.values()) {
        // History is not a late arrival (lane 0195b): the real store leaves it out, so the double does too.
        if (e.history === true) continue
        if (since && e.ingested_at < since) continue
        if (until && e.occurred_at >= until) continue
        const day = String(e.occurred_at).slice(0, 10)
        const at = marks.get(day)
        if (!at || e.ingested_at > at) marks.set(day, e.ingested_at)
      }
      return { marks: [...marks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, at]) => ({ day, at })) }
    },

    async listEvents({ since, until, ingested_after: ingestedAfter, source, exclude_history: excludeHistory = false, limit = 200, cursor } = {}, actor) {
      if (!["owner", "admin"].includes(actor?.role)) throw new StoreError(403, "forbidden", "Events are read by the space's owner only.")
      const all = [...events.values()]
        .filter((e) => (!since || e.occurred_at >= since) && (!until || e.occurred_at < until) && (!ingestedAfter || e.ingested_at > ingestedAfter) && (!source || e.source === source) && (!excludeHistory || e.history !== true))
        .sort((a, b) => (a.occurred_at < b.occurred_at ? -1 : a.occurred_at > b.occurred_at ? 1 : a.id < b.id ? -1 : 1))
      const start = Number(cursor ?? 0) || 0
      const n = Math.max(1, Math.min(Number(limit) || 200, 500))
      return { events: all.slice(start, start + n).map(clone), cursor: start + n < all.length ? String(start + n) : null }
    },

    async listSources(_input, actor) {
      requireRead(actor)
      return { sources: [...sources.values()].map(clone) }
    },

    async bindSource({ source, account = "default", owner, enabled = true } = {}, actor) {
      requireWrite(actor)
      noteMeta(actor)
      const entry = { source, account, owner_id: owner?.id ?? null, owner_label: owner?.label ?? null, status: "confirmed", confirmed_at: nowIso(), cursor: null, cursor_at: null, enabled }
      sources.set(`${source}:${account}`, entry)
      return { source: clone(entry) }
    },

    async listProposals({ limit = 100 } = {}, actor) {
      requireRead(actor)
      const list = [...records.values()]
        .filter((r) => r.kind === "proposal" && r.status === "proposed")
        .sort((a, b) => (b.created < a.created ? -1 : 1))
      return { proposals: list.slice(0, Math.min(Number(limit) || 100, 100)).map(clone) }
    },

    async decideProposal({ id, decision, payload, reason } = {}, actor) {
      const p = records.get(id)
      if (!p || p.kind !== "proposal") throw new StoreError(404, "not_found", `No proposal ${id}.`)
      requireWrite(actor)
      if (decision === "reject") {
        const proposal = update(p, { status: "rejected", fields: { ...p.fields, decision_reason: reason ?? null } }, actor)
        // As the service: only the person's reason, typed in the console (a browser session), becomes a preference.
        if (reason && actor?.credential === "session") create({ kind: "memory", type: "preference", title: String(reason).slice(0, 200), body: String(reason), stated_by: "person" }, actor)
        return { proposal }
      }
      const f = p.fields
      const data = payload ?? f.payload ?? {}
      let applied = null
      if (f.action === "create" || f.action === "open_commitment") applied = (await space.put({ record: { ...data, status: "current" } }, actor)).record
      else if (f.action === "close_commitment") {
        const target = records.get(f.target_id)
        if (target) applied = update(target, { fields: { ...target.fields, state: "done", closed_at: nowIso() } }, actor)
      } else if (f.action === "append") applied = (await space.append({ path: f.target_path, section: data.section, text: data.text }, actor)).record
      else if (f.action === "supersede") {
        applied = data.mode === "contest" ? (await space.revise({ id: f.target_id, action: "contest" }, actor)).record : (await space.revise({ id: f.target_id, action: "correct", body: data.body, title: data.title }, actor)).record
      } else if (f.action === "merge") {
        const target = byPath(f.target_path) ?? records.get(f.target_id)
        if (target) applied = update(target, { fields: { ...target.fields, identities: { ...(target.fields.identities ?? {}), ...(data.identities ?? {}) } } }, actor)
      }
      return { proposal: update(p, { status: "accepted" }, actor), applied }
    },

    /** What the catch-up runs started in a window spent: `{tokens, runs}`. */
    async catchUpTokens({ from, to } = {}, actor) {
      requireRead(actor)
      const list = [...runs.values()].filter((r) => r.catch_up === true && (!from || r.started >= from) && (!to || r.started < to))
      return { tokens: list.reduce((sum, r) => sum + (Number(r.tokens) || 0), 0), runs: list.length }
    },

    /** The read marks of one local day: `{reads: [{key, fingerprint}]}`, as the service's own principal. */
    async unitReads({ day } = {}, actor) {
      requireRead(actor)
      if (!ROUTINE_USERS.has(actor?.user)) throw new StoreError(403, "forbidden", "Read marks are internal to the routines.")
      const day_ = reads.get(String(day)) ?? new Map()
      return { reads: [...day_.entries()].map(([key, fingerprint]) => ({ key, fingerprint })).sort((a, b) => (a.key < b.key ? -1 : 1)) }
    },

    /** Upsert one run's read marks for a local day. */
    async markUnitsRead({ day, units = [], run } = {}, actor) {
      requireWrite(actor)
      if (!ROUTINE_USERS.has(actor?.user)) throw new StoreError(403, "forbidden", "Read marks are internal to the routines.")
      const day_ = reads.get(String(day)) ?? new Map()
      reads.set(String(day), day_)
      for (const unit of units) day_.set(String(unit.key), String(unit.fingerprint))
      void run
      return { marks: units.length }
    },

    /** The gate's verdicts for one local day: `{reads: [{key, verdict}]}`. */
    async traitReads({ day } = {}, actor) {
      requireRead(actor)
      if (!ROUTINE_USERS.has(actor?.user)) throw new StoreError(403, "forbidden", "Gate verdicts are internal to the routines.")
      const day_ = traitVerdicts.get(String(day)) ?? new Map()
      return { reads: [...day_.entries()].map(([key, verdict]) => ({ key, verdict })).sort((a, b) => (a.key < b.key ? -1 : 1)) }
    },

    /** Upsert one run's gate verdicts for a local day, bounded as the service bounds them. */
    async markTraitReads({ day, reads: verdicts = [] } = {}, actor) {
      requireWrite(actor)
      if (!ROUTINE_USERS.has(actor?.user)) throw new StoreError(403, "forbidden", "Gate verdicts are internal to the routines.")
      const day_ = traitVerdicts.get(String(day)) ?? new Map()
      traitVerdicts.set(String(day), day_)
      for (const read of verdicts) day_.set(String(read.key), String(read.verdict))
      for (const key of day_.keys()) if (day_.size > 4_000) day_.delete(key)
      return { reads: verdicts.length }
    },

    async putRun({ run } = {}, actor) {      requireWrite(actor)
      if (!run?.id) throw new StoreError(400, "invalid_run", "A run needs an id.")
      const order = runs.get(run.id)?._order ?? (seq += 1)
      runs.set(run.id, { ...clone(run), _order: order })
      return { run: clone(run) }
    },

    /** Newest first by `started`, then by when the run was first written. */
    async listRuns({ routine, date, budget_day: budgetDay, status, limit = 50 } = {}, actor) {
      requireRead(actor)
      const list = [...runs.values()]
        .filter((r) => (!routine || r.routine === routine) && (!date || r.date === date) && (!budgetDay || r.budget_day === budgetDay) && (!status || r.status === status))
        .sort((a, b) => (b.started < a.started ? -1 : b.started > a.started ? 1 : b._order - a._order))
      return { runs: list.slice(0, Math.max(1, Math.min(Number(limit) || 50, 200))).map(({ _order, ...r }) => clone(r)) }
    },

    async stats(_input, actor) {
      requireRead(actor)
      const counts = {}
      for (const r of records.values()) counts[`${r.kind}:${r.status}`] = (counts[`${r.kind}:${r.status}`] ?? 0) + 1
      return { counts, events: events.size, sources: sources.size, runs: runs.size }
    },

    /** Test-only: every record, unfiltered. */
    _all() {
      return [...records.values()].map(clone)
    },
    _events() {
      return [...events.values()].map(clone)
    },
  }
  return space
}

export function eventId(source, account, externalId) {
  return `evt_${createHash("sha256").update(`${source}:${account}:${externalId}`).digest("hex").slice(0, 24)}`
}

/**
 * `openTestStore({now?}) → {forSpace(spaceId) → SpaceStore, listSpaces(), close()}`,
 * as `openStore` (§2.5). Each space is separate: nothing is shared between
 * them, even when two spaces share a container.
 */
export function openTestStore({ now } = {}) {
  const clock = typeof now === "function" ? now : () => new Date()
  const spaces = new Map()
  return {
    forSpace(spaceId) {
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(String(spaceId))) throw new StoreError(400, "invalid_space", "Bad space id.")
      let s = spaces.get(spaceId)
      if (!s) {
        s = createSpace(spaceId, clock)
        spaces.set(spaceId, s)
      }
      return s
    },
    /** Every space with its meta: [{space, team, space_kind, owner_user}]. */
    async listSpaces() {
      return Promise.all([...spaces.values()].map((s) => s.meta()))
    },
    close() {
      spaces.clear()
    },
  }
}
