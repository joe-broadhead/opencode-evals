/**
 * Seeding and reading the 0.9.0 records service for the live eval.
 *
 * Ordinary seeds and all reads go through the records API in
 * docs/design/memory-v1-contracts.md §2: `POST /records/v1/<method>` with the
 * §2.2 scope headers, as the gateway would send them. Nothing reads the
 * store's files or calls its module, except the explicitly selected pre-existing
 * injection fixture below. The stub serves the same routes (contract §2.5: the HTTP
 * server and the plugin's test stub share `records/src/store.js`).
 *
 * A scenario describes its starting state as a `world`:
 *
 *   world: {
 *     records: [
 *       { ref, space?, as?, kind, type, path?, title?, body?, status?, stated_by?, fields?, source?, links? },
 *       { ref?, revise: "<ref>", action?: "correct", body, title?, reason?, space?, as? },
 *       { append: "<path>", section, text, space?, as? },
 *     ],
 *     events: [{ space?, source, account, owner: { id, label }, events: [Event] }],
 *     failures: [{ route, times?, status? }],   // the stub's POST /debug/fail
 *     grants: [{ ... }],                        // control grants, read by the fake control plane
 *   }
 *
 * `space` is a key: `local` (local mode), or `personal`, `shared` or `other`
 * (control mode; `other` is a space the eval user is not a member of). `as` is
 * the author's user id (default `eval`); `principal: "agent"` marks a write on an
 * agent credential, and every other seed is the person's own, with the agent name
 * a person's own coding agent carries. `ref` names a record so a later entry can
 * revise it.
 *
 * `legacyPayload` turns the same world into a 0.8.4 `/debug/seed` payload
 * (atoms, wiki files and commitments), so the answer-only views can pair 0.9.0
 * with 0.8.4 on identical facts (docs/evals/README.md, "0.9.0 gate").
 */
import fs from "node:fs"
import path from "node:path"
import { DatabaseSync } from "node:sqlite"

export const RECORDS_PREFIX = "/records/v1"
/** The bearer the harness sends and gives the stub (`MEM_STUB_RECORDS_KEY`). Not a secret. */
export const RECORDS_KEY = "eval-records-key"
/**
 * The user the eval runs as: the fake control plane's caller
 * (`harness-control.mjs`), the author of every write an attempt makes, and so
 * the only reader `records.list` shows a held team write to.
 */
export const EVAL_USER = "eval"
export const SEED_TZ = "Europe/London"
/**
 * The service id the eval's fake control plane places every space on
 * (harness.mjs `service_id`). The gateway sends that placement id as
 * `x-records-service`.
 */
export const EVAL_SERVICE_ID = "eval-service"
const SPACE_KINDS = new Set(["personal", "shared"])

/** Statuses a full read collects when `status: "all"` is refused. */
const STATUSES = ["current", "contested", "superseded", "retired", "proposed", "accepted", "rejected"]

export class RecordsError extends Error {
  constructor(method, status, code, message) {
    super(`records ${method}: HTTP ${status}${code ? ` ${code}` : ""}: ${message}`)
    this.method = method
    this.status = status
    this.code = code
  }
}

/**
 * The §2.2 headers for one space, as the gateway builds them
 * (`deploy/auth/records-scope.mjs`). Seeding, probing and reading all go
 * through here, so a caller cannot omit a required header.
 *
 * Kind and service come from the space when it has them (the control spaces
 * carry `kind`; a caller may set `service` or `serviceId`). A local store or a
 * probe has no control kind: the gateway only ever sends `personal` or
 * `shared`, and a local store is one person's, so `personal`. The service
 * defaults to the eval placement's id.
 *
 * @param {{ containerId: string, spaceId?: string, kind?: string, service?: string, serviceId?: string }} space
 * @param {{ user?: string, role?: string, agent?: string, principal?: "user"|"agent", session?: string, tz?: string, service?: string, grants?: Array<{prefix: string, role: string}>, key?: string }} [actor]
 */
export function recordsHeaders(space, actor = {}) {
  const kind = SPACE_KINDS.has(space?.kind) ? space.kind : "personal"
  const service = [space?.serviceId, space?.service, actor?.service].find((value) => typeof value === "string" && value) ?? EVAL_SERVICE_ID
  const headers = {
    authorization: `Bearer ${actor.key ?? RECORDS_KEY}`,
    "content-type": "application/json",
    "x-records-space": String(space.spaceId || space.containerId),
    "x-records-space-kind": kind,
    "x-records-team": String(space.containerId),
    "x-records-service": String(service),
    "x-records-user": String(actor.user ?? "eval"),
    "x-records-role": String(actor.role ?? "owner"),
    "x-records-agent": String(actor.agent ?? "seed"),
    "x-records-session": String(actor.session ?? "ses_seed"),
    "x-records-tz": String(actor.tz ?? SEED_TZ),
  }
  // `x-records-principal` is the gateway's verified credential, and only an
  // agent credential sets it: a person's own seed carries an agent *name* (their
  // coding agent) and is still the person's (0.11 review, round 4). A scenario
  // that means an agent-principal write says `principal: "agent"`; nothing else
  // ever sends it, so a person's notes are never seeded as an agent's.
  if (actor.principal === "agent") headers["x-records-principal"] = "agent"
  if (actor.grants) headers["x-records-grants"] = JSON.stringify(actor.grants)
  return headers
}

/** The stub wraps answers as `{code, message, data}`; the service answers bare. */
function unwrap(body) {
  if (body && typeof body === "object" && "data" in body && "code" in body && !("records" in body) && !("record" in body)) {
    return body.data
  }
  return body
}

/**
 * Call one records method.
 *
 * @param {string} baseURL the stub (or a records service) base URL
 * @param {string} method e.g. `records.put`
 * @param {object} body
 * @param {Record<string, string>} headers from `recordsHeaders`
 * @param {{ prefix?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} [options]
 */
export async function recordsCall(baseURL, method, body, headers, options = {}) {
  const prefix = options.prefix ?? RECORDS_PREFIX
  const doFetch = options.fetchImpl ?? fetch
  const response = await doFetch(`${baseURL}${prefix}/${method}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body ?? {}),
    signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
  }).catch((error) => { throw new Error(`records ${method}: ${error.message}`, { cause: error }) })
  const text = await response.text()
  let parsed = {}
  if (text) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = { raw: text }
    }
  }
  const error = parsed?.error && typeof parsed.error === "object" ? parsed.error : null
  if (!response.ok || error) {
    throw new RecordsError(method, response.status, String(error?.code ?? parsed?.code ?? ""), String(error?.message ?? parsed?.message ?? text).slice(0, 300))
  }
  return unwrap(parsed)
}

/** The record fields a seed entry may set (the rest are the service's). */
function recordBody(entry) {
  const record = { kind: entry.kind ?? "memory", type: entry.type ?? "fact" }
  for (const key of ["path", "title", "body", "status", "stated_by", "fields", "source", "task", "links", "supersedes"]) {
    if (entry[key] !== undefined) record[key] = entry[key]
  }
  if (record.kind === "commitment" && record.fields?.what && !record.title) record.title = record.fields.what
  return record
}

/**
 * Seed a world through the records API. Events first (a source is bound, then
 * its events ingested), then records in order (refs resolve as they go), then
 * the stub's failure injections, so seeding itself never meets a failure.
 *
 * @param {string} baseURL
 * @param {object} world
 * @param {(key?: string) => { containerId: string, spaceId?: string }} spaceFor
 * @param {{ fetchImpl?: typeof fetch, prefix?: string, preexisting?: { dataDir: string, refs: string[] } }} [options]
 * @returns {Promise<{ refs: Record<string, string> }>}
 */
export async function seedWorld(baseURL, world, spaceFor, options = {}) {
  const refs = {}
  if (!world) return { refs }
  // A seeded record the world marks as the person's was written by the person
  // (in the console): since 0.9.8 the store keeps stated_by person only from a
  // browser session, which the stub honours with MEM_STUB_RECORDS_SESSION=1.
  const call = (method, body, entry) =>
    recordsCall(baseURL, method, body, { ...recordsHeaders(spaceFor(entry?.space), { user: entry?.as ?? "eval", role: entry?.role ?? "owner" }), ...(method === "records.put" && body?.record?.stated_by === "person" ? { "x-records-credential": "session" } : {}) }, options)

  for (const batch of world.events ?? []) {
    // The person's bind since 0.9.7: a request, the collector's report, and the
    // console's confirm (a browser session, which the stub honours only with
    // MEM_STUB_RECORDS_SESSION=1, as harness.mjs starts it). Personal space only.
    const own = (method, body) =>
      recordsCall(baseURL, method, body, { ...recordsHeaders({ ...spaceFor(batch?.space), kind: "personal" }, { user: batch?.as ?? "eval", role: "owner" }), ...(method === "sources.bind" ? { "x-records-credential": "session" } : {}) }, options)
    await own("sources.request", { source: batch.source, account: batch.account })
    await own("sources.report", { source: batch.source, account: batch.account, owner: batch.owner })
    await own("sources.bind", { source: batch.source, account: batch.account, owner: batch.owner, enabled: true })
    await call(
      "events.ingest",
      { source: batch.source, account: batch.account, owner: batch.owner, events: batch.events ?? [], cursor: batch.cursor ?? "seed-1" },
      batch,
    )
  }

  for (const entry of world.records ?? []) {
    if (entry.revise) {
      const id = refs[entry.revise]
      if (!id) throw new Error(`world: revise names unknown ref ${entry.revise}`)
      const answer = await call(
        "records.revise",
        { id, action: entry.action ?? "correct", ...(entry.body !== undefined ? { body: entry.body } : {}), ...(entry.title ? { title: entry.title } : {}), ...(entry.reason ? { reason: entry.reason } : {}) },
        entry,
      )
      if (entry.ref && answer?.record?.id) refs[entry.ref] = answer.record.id
      continue
    }
    if (entry.append) {
      await call("records.append", { path: entry.append, section: entry.section, text: entry.text }, entry)
      continue
    }
    const preexisting = options.preexisting?.refs.includes(entry.ref)
    // A migrated external record can predate today's curation. Create its
    // metadata with the normal API, then restore its exact historical text in
    // this attempt's throwaway SQLite file. FTS triggers maintain the index.
    // This exception is opted into by the harness for one fixture, not by a
    // scenario or by production writes. Never silently bypass a refusal.
    if (preexisting && (entry.kind !== "memory" || entry.stated_by !== "external" || !entry.ref)) {
      throw new Error("world: pre-existing fixture must be a referenced external memory")
    }
    const record = recordBody(entry)
    const answer = await call("records.put", { record: preexisting ? { ...record, title: "Historical external record", body: "Historical external record." } : record }, entry)
    if (preexisting) {
      const id = answer?.record?.id
      const space = spaceFor(entry.space)
      const spaceId = String(space.spaceId || space.containerId)
      if (!id || !/^[A-Za-z0-9_.-]{1,128}$/.test(spaceId)) throw new Error("world: invalid pre-existing record identity")
      const file = path.join(options.preexisting.dataDir, "spaces", `${spaceId}.db`)
      if (!fs.existsSync(file)) throw new Error("world: pre-existing fixture database missing")
      const db = new DatabaseSync(file)
      try {
        db.exec("pragma busy_timeout = 5000")
        const result = db.prepare("update records set title = ?, body = ? where id = ? and kind = 'memory' and stated_by = 'external'").run(record.title ?? "", record.body ?? "", id)
        if (Number(result.changes) !== 1) throw new Error("world: pre-existing fixture update did not match one external memory")
      } finally {
        db.close()
      }
      const actual = await call("records.get", { ids: [id] }, entry)
      if (actual?.records?.length !== 1 || actual.records[0].title !== (record.title ?? "") || actual.records[0].body !== (record.body ?? "")) throw new Error("world: pre-existing fixture read-back differs")
    }
    if (entry.ref) {
      const id = answer?.record?.id
      if (!id) throw new Error(`world: records.put for ref ${entry.ref} returned no id`)
      refs[entry.ref] = id
    }
  }

  const doFetch = options.fetchImpl ?? fetch
  for (const failure of world.failures ?? []) {
    const response = await doFetch(`${baseURL}/debug/fail`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ route: failure.route, times: failure.times ?? 1, status: failure.status ?? 503 }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) throw new Error(`world: /debug/fail ${failure.route}: HTTP ${response.status}`)
  }
  return { refs }
}

/**
 * Read every record of each space, all statuses, bodies whole. Each record is
 * labelled with the space key it was read from, so an assertion can say
 * "no record in `shared` contains X".
 *
 * A held team write (a `team_write` proposal) is listed only to its author
 * (`records/src/store.js` filters `records.list` to `author_user = caller`), so
 * the personal space is also read once as `EVAL_USER`: a note a bearer's write
 * was held for is observable, and so is a private line inside it. That read
 * asks for one kind and one type, so nothing else about what this returns
 * changes. A page's history is not read: one row per id, its current version.
 *
 * @param {string} baseURL
 * @param {Array<{ key: string, containerId: string, spaceId?: string }>} spaces
 */
export async function readWorld(baseURL, spaces, options = {}) {
  const records = []
  const errors = []
  for (const space of spaces) {
    const headers = recordsHeaders(space, { user: "eval-reader", role: "owner", agent: "eval-reader" })
    const seen = new Map()
    const collect = async (filter, as = headers) => {
      let cursor
      for (let page = 0; page < 20; page += 1) {
        const answer = await recordsCall(baseURL, "records.list", { ...filter, limit: 200, full: true, ...(cursor ? { cursor } : {}) }, as, options)
        for (const record of answer?.records ?? []) seen.set(record.id, { ...record, space: space.key })
        cursor = answer?.cursor
        if (!cursor) break
      }
    }
    // A store that refuses `status: "all"` is read one status at a time, as before.
    const collectEveryStatus = async (filter, as) => {
      try {
        await collect({ status: "all", ...filter }, as)
      } catch (error) {
        if (!(error instanceof RecordsError) || error.status !== 400) throw error
        for (const status of STATUSES) await collect({ status, ...filter }, as)
      }
    }
    try {
      await collectEveryStatus({})
      if (space.key === "personal") {
        await collectEveryStatus({ kind: ["proposal"], type: ["team_write"] }, recordsHeaders(space, { user: EVAL_USER, role: "owner", agent: "eval" }))
      }
      records.push(...seen.values())
    } catch (error) {
      errors.push(`${space.key}: ${error.message}`)
    }
  }
  return { records, errors }
}

/**
 * Does this base URL serve the records routes? `space.stats` is a read every
 * caller may make (contract §2.4); a 404 means the routes are not there yet.
 */
export async function probeRecords(baseURL, options = {}) {
  try {
    await recordsCall(baseURL, "space.stats", {}, recordsHeaders({ containerId: "eval-probe", spaceId: "eval-probe" }), options)
    return { ok: true, reason: "" }
  } catch (error) {
    return { ok: false, reason: error?.message ?? String(error) }
  }
}

/** The tool names a plugin package declares (`package.json` `jelly.tools`), as `mem_<name>`. */
export function pluginTools(pluginRoot) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pluginRoot, "package.json"), "utf8"))
    return (pkg?.jelly?.tools ?? []).map((tool) => String(tool?.permission ?? `mem_${String(tool?.name ?? "").replace(/^mem\./, "")}`))
  } catch {
    return []
  }
}

/**
 * What an item needs that is missing. `needs` entries: `records` (the stub's
 * records routes), `tool:<name>` (the plugin declares `mem_<name>`), and
 * `control` (the fake control plane, always present).
 *
 * @param {string[]} needs
 * @param {{ records: boolean, tools: string[] }} caps
 */
export const V090_TOOLS = Object.freeze(["mem_revise", "mem_page", "mem_share"])

export function missingNeeds(needs = [], caps) {
  const missing = []
  for (const need of needs) {
    if (need === "records" && !caps.records) missing.push("records routes on the stub (lane PLUG-B)")
    else if (need === "v090") {
      const absent = V090_TOOLS.filter((tool) => !caps.tools.includes(tool))
      if (absent.length > 0) missing.push(`the 0.9.0 tool surface: ${absent.join(", ")} (lanes PLUG-A/PLUG-B)`)
    } else if (need.startsWith("tool:") && !caps.tools.includes(`mem_${need.slice(5)}`)) missing.push(`mem_${need.slice(5)} (lanes PLUG-A/PLUG-B)`)
  }
  return [...new Set(missing)]
}

/**
 * What each selected 0.9.0 item needs that this checkout lacks. Seeding a world
 * as records needs the records routes, even for an answer view; a legacy seed
 * needs nothing new.
 *
 * @param {Array<any>} selected
 * @param {{ records: boolean, tools: string[] }} caps
 * @param {"records" | "legacy"} [seedAs]
 */
export function readinessRows(selected, caps, seedAs = "records") {
  return selected
    .filter((scenario) => scenario.v1)
    .map((scenario) => {
      const needs = new Set(scenario.needs ?? [])
      if (scenario.world && seedAs === "records") needs.add("records")
      if (seedAs === "legacy") needs.delete("records")
      return { id: scenario.id, missing: missingNeeds([...needs], caps) }
    })
}

// ---------------------------------------------------------------------------
// 0.8.4 translation, for the answer-only views
// ---------------------------------------------------------------------------

const ATOM_TYPE = { fact: "episodic", decision: "instruction", constraint: "instruction", procedure: "instruction", preference: "persona" }

function legacyDate(index) {
  const day = new Date(Date.UTC(2026, 9, 1 + index, 9, 0, 0))
  return day.toISOString()
}

/**
 * The same world as 0.8.4 would hold it. Memories become atoms; every version
 * of a corrected value stays, dated in order (the old values are still in the
 * store, as captured turns were in 0.8.4); pages become files in the space's
 * "My knowledge" wiki; commitments go to the records wiki. Events, proposals
 * and failures have no 0.8.4 form and are dropped: items that need them are
 * never in an answer view.
 *
 * @param {object} world
 * @param {(key?: string) => { user_id: string, agent_id: string, team_id: string }} scope
 */
export function legacyPayload(world, scope) {
  const atoms = []
  const wikiFiles = []
  const commitments = []
  const byRef = new Map()
  let index = 0
  for (const entry of world?.records ?? []) {
    index += 1
    const at = entry.date ? new Date(`${entry.date}T09:00:00.000Z`).toISOString() : legacyDate(index)
    if (entry.append) {
      const file = wikiFiles.find((candidate) => candidate.filename === `${entry.append}.md` && candidate.space === entry.space)
      if (file) file.content += `\n\n## ${entry.section}\n${entry.text}`
      continue
    }
    const base = entry.revise ? byRef.get(entry.revise) ?? {} : {}
    // 0.8.4 had no retire: the nearest is a forget, so the retired value's
    // atom is dropped. A `confirm` or `restore` changes nothing here.
    if (entry.revise && entry.action === "retire") {
      const index = atoms.indexOf(base.atom)
      if (index !== -1) atoms.splice(index, 1)
      continue
    }
    if (entry.revise && entry.action && entry.action !== "correct") continue
    const merged = { ...base, ...entry, kind: entry.kind ?? base.kind ?? "memory", type: entry.type ?? base.type ?? "fact", space: entry.space ?? base.space }
    if (entry.ref) byRef.set(entry.ref, merged)
    if (merged.kind === "memory") {
      const own = scope(merged.space)
      merged.atom = {
        ...own,
        owner_user_id: own.user_id,
        visibility: merged.space === "shared" ? "team" : "private",
        type: ATOM_TYPE[merged.type] ?? "episodic",
        content: merged.body ?? merged.title ?? "",
        created_at: at,
        updated_at: at,
      }
      atoms.push(merged.atom)
    } else if (merged.kind === "page") {
      wikiFiles.push({
        ...(merged.space && merged.space !== "local" ? { space: merged.space } : {}),
        wiki: "My knowledge",
        filename: `${merged.path}.md`,
        content: `# ${merged.title ?? merged.path}\n\n${merged.body ?? ""}`,
      })
    } else if (merged.kind === "commitment") {
      const fields = merged.fields ?? {}
      commitments.push({
        ...(merged.space && merged.space !== "local" ? { space: merged.space } : {}),
        id: `cmt_seed_${index}`,
        what: fields.what ?? merged.title ?? "",
        owner: fields.owner ?? "user",
        state: fields.state ?? "open",
        ...(fields.due ? { due: fields.due } : {}),
        ...(fields.trigger ? { trigger: fields.trigger } : {}),
        created: at.slice(0, 10),
        updated: at.slice(0, 10),
        session: "ses_seed",
      })
    }
  }
  return {
    atoms,
    ...(wikiFiles.length ? { wikiFiles } : {}),
    ...(commitments.length ? { commitments } : {}),
  }
}
