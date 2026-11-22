/**
 * The one place the stub meets the records store (contract §2.5).
 *
 * The store is lane REC's `records/src/store.js`, the very module the records
 * service runs, so the stub answers as production does: `openStore({dataDir})
 * → { forSpace(spaceId) → SpaceStore, listSpaces(), close() }` with one async
 * method per §2.4 method, each taking `(input, actor)`. Records are keyed by
 * the control space id, never the container.
 *
 * The adapter is the HTTP side the records service has in front of the store:
 * the method table, the actor from the scope headers, and the answer and error
 * shapes of §2.2. In local direct mode there is no gateway, so a request with
 * no `x-records-*` headers is read from the plugin's own headers as the owner
 * of a personal space: `x-mem-space-id` (else the container, else "local"),
 * `x-tdai-*` and `x-mem-tz`, as the stub's `/v3` routes trust them.
 */
import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import { fileURLToPath } from "node:url"
import { openStore } from "../records/src/store.js"
import { createJobs } from "../records/src/jobs/index.js"

/** The store module the stub serves. */
export const STORE_MODULE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "records", "src", "store.js")

/** §2.4 method → the store's camelCase method (§2.5). */
export const METHODS = Object.freeze({
  // The agent registry (capture fills it, the console reads the caller's own):
  "agents.seen": "agentsSeen",
  "agents.mine": "agentsMine",
  "records.put": "put",
  "records.get": "get",
  "records.list": "list",
  "records.search": "search",
  "records.revise": "revise",
  "records.append": "append",
  "records.move": "move",
  "records.delete": "delete",
  "records.history": "history",
  "records.links": "links",
  "records.backlinks": "backlinks",
  "records.export": "exportTar",
  // 0.11 source removals: a copy registered in the space it came from.
  "records.copied": "noteCopies",
  // Slice 25: the origin's copies of one record, a count for the rest.
  "records.copies": "copies",
  "events.ingest": "ingestEvents",
  "events.cursor": "eventsCursor",
  "events.list": "listEvents",
  "events.forget": "forgetEvents",
  "sources.list": "listSources",
  "sources.bind": "bindSource",
  "sources.import": "importHistory",
  "sources.unbind": "unbindSource",
  "sources.request": "requestSource",
  "sources.report": "reportSource",
  "sources.cancel": "cancelSourceRequest",
  "sources.collected": "noteCollection",
  "plugins.report": "reportPlugins",
  "plugins.list": "listPlugins",
  "plugins.request": "requestPlugin",
  "plugins.probe": "probePlugin",
  "plugins.consent": "consentPlugin",
  "plugins.reconfirm": "reconfirmPlugin",
  "plugins.pause": "pausePlugin",
  "plugins.resume": "resumePlugin",
  "plugins.flag": "flagPlugin",
  "review.list": "listProposals",
  "proposals.create": "createProposal",
  "proposals.askChanges": "askProposalChanges",
  "review.decide": "decideProposal",
  "review.edit": "editHeldWrite",
  "space.stats": "stats",
  "space.purge": "purge",
  "forgotten.put": "putForgotten",
  "forgotten.list": "listForgotten",
  "forgotten.lift": "liftForgotten",
  "forgotten.match": "matchForgotten",
  "forgotten.check": "checkForgotten",
})

/**
 * Memory Jobs (DESIGN-MEMORY-JOBS §12, J1) live in the job runner, not the
 * store: the stub answers them from it, so the console's Jobs page and the
 * gateway's session-only methods are exercised end to end.
 */
export const JOB_METHODS = Object.freeze({
  "jobs.templates": "template",
  "jobs.create": "create",
  "jobs.draft": "draft",
  "jobs.list": "list",
  "jobs.get": "get",
  "jobs.versions": "versions",
  "jobs.diff": "diff",
  "jobs.request": "request",
  "jobs.probe": "probe",
  "jobs.consent": "consent",
  "jobs.activate": "activate",
  "jobs.pause": "pause",
  "jobs.resume": "resume",
  "jobs.archive": "archive",
  "jobs.remove": "remove",
  "jobs.runs": "runs",
  "jobs.logs": "logs",
  "jobs.items": "items",
  "jobs.hosts": "hosts",
  "jobs.host": "report",
  "jobs.claim": "claim",
  "jobs.checkpoint": "checkpoint",
  "jobs.finish": "finish",
  "jobs.curate": "curate",
  "jobs.run": "runNow",
  "jobs.meetings": "meetings",
})

const runners = new WeakMap()
const QUIET = { debug() {}, info() {}, warn() {}, error() {} }
function jobsOf(store) {
  let runner = runners.get(store)
  if (!runner) {
    runner = createJobs({ store, log: QUIET, config: {} })
    runners.set(store, runner)
  }
  return runner
}

/** Routines run in the service, not the store; the stub records the request and runs nothing. */
const ROUTINE_METHODS = new Set(["routines.run", "routines.status"])
const ROUTINES = ["daily", "weekly", "monthly", "lint", "dashboard"]
const ROLES = new Set(["viewer", "editor", "admin", "owner", "grant"])
const KINDS = new Set(["personal", "shared"])
const ID = /^[A-Za-z0-9_.-]{1,128}$/

/**
 * Open the store for a stub whose state lives at `dataDir` ("" keeps it in a
 * temporary directory). `now` (→ Date) is the stub's clock, so a pinned stub
 * dates its records the same way.
 */
export async function openRecordsStore({ dataDir = "", now } = {}) {
  const clock = typeof now === "function" ? { now } : {}
  const heldReceiptKey = "stub-only-held-receipt-key-not-for-production"
  if (dataDir) return openStore({ dataDir, ...clock, heldReceiptKey })
  // The store keeps one SQLite file per space and needs a directory: an
  // in-memory stub gets a temporary one, removed when the store closes or the
  // process exits, so test runs leave nothing behind.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stub-records-"))
  const remove = () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {}
  }
  process.once("exit", remove)
  const store = openStore({ dataDir: dir, ...clock, heldReceiptKey })
  const close = async () => {
    try {
      await store.close()
    } finally {
      process.off("exit", remove)
      remove()
    }
  }
  return new Proxy(store, { get: (target, key) => (key === "close" ? close : Reflect.get(target, key)) })
}

/** The core's service id, recorded in meta for the routines; a value the store would refuse is left out. */
const SERVICE = /^[A-Za-z0-9_.:-]{1,200}$/
function serviceOf(value) {
  return value && SERVICE.test(value) ? value : undefined
}

function header(headers, name) {
  const value = headers?.[name]
  if (Array.isArray(value)) return value[0]
  return value === undefined || value === null || value === "" ? undefined : String(value)
}

/**
 * The caller, from the gateway's `x-records-*` headers (§2.2), or, in local
 * direct mode, from the plugin's own headers as the owner of a personal space.
 *
 * @returns {{ space: string, actor: { user?: string, agent?: string, session?: string, role: string, grants: any[], space: string, spaceKind: string, team?: string, service?: string, tz?: string } } | { error: { status: number, code: string, message: string, next: string } }}
 */
export function actorFrom(headers = {}) {
  const refuse = (code, message) => ({ error: { status: 400, code, message, next: "send the request through the gateway" } })
  const gateway = ["x-records-space", "x-records-role", "x-records-team"].some((name) => header(headers, name) !== undefined)
  if (!gateway) {
    const team = header(headers, "x-tdai-team-id") ?? "local"
    const space = header(headers, "x-mem-space-id") ?? team
    if (!ID.test(space)) return refuse("invalid_space", "the space id is not valid")
    return {
      space,
      actor: {
        // The store needs a caller (contract §2.2: x-records-user is required).
        user: header(headers, "x-tdai-user-id") ?? "local",
        agent: header(headers, "x-tdai-agent-id"),
        session: header(headers, "x-tdai-session-id"),
        role: "owner",
        grants: [],
        space,
        spaceKind: "personal",
        team,
        service: serviceOf(header(headers, "x-tdai-service-id")),
        tz: header(headers, "x-mem-tz"),
        // The plugin's own bearer: never a browser session.
        credential: "bearer",
      },
    }
  }
  const space = header(headers, "x-records-space")
  if (!space || !ID.test(space)) return refuse("invalid_space", "x-records-space is missing or not a space id")
  const spaceKind = header(headers, "x-records-space-kind")
  if (!KINDS.has(String(spaceKind))) return refuse("invalid_space_kind", "x-records-space-kind must be personal or shared")
  const team = header(headers, "x-records-team")
  if (!team || !ID.test(team)) return refuse("invalid_team", "x-records-team is missing or not a container id")
  const role = header(headers, "x-records-role")
  if (!ROLES.has(String(role))) return refuse("invalid_role", "x-records-role must be viewer, editor, admin, owner or grant")
  let grants = []
  if (role === "grant") {
    try {
      grants = JSON.parse(header(headers, "x-records-grants") ?? "[]")
      if (!Array.isArray(grants)) throw new Error("not a list")
    } catch {
      return refuse("invalid_grants", "x-records-grants must be a JSON list of {prefix, role}")
    }
  }
  // The spaces the gateway says the caller may read (slice 25): a copy into
  // any other space is a count only. Absent or malformed is no list at all.
  let readableSpaces = []
  const spacesHeader = header(headers, "x-records-read-spaces")
  if (spacesHeader !== undefined && spacesHeader !== "") {
    try {
      const parsed = JSON.parse(spacesHeader)
      if (Array.isArray(parsed) && parsed.every((id) => typeof id === "string" && ID.test(id))) readableSpaces = parsed
    } catch {
      readableSpaces = []
    }
  }
  return {
    space,
    actor: {
      user: header(headers, "x-records-user"),
      readableSpaces,
      agent: header(headers, "x-records-agent"),
      session: header(headers, "x-records-session"),
      role,
      grants,
      space,
      spaceKind,
      team,
      service: header(headers, "x-records-service"),
      tz: header(headers, "x-records-tz"),
      // A browser session is the real gateway's console's to vouch for. The
      // simulator ignores the header unless a test opts in
      // (MEM_STUB_RECORDS_SESSION=1), so a plugin under test cannot claim one.
      credential: process.env.MEM_STUB_RECORDS_SESSION === "1" && header(headers, "x-records-credential") === "session" ? "session" : "bearer",
      principal: header(headers, "x-records-principal") === "agent" ? "agent" : "user",
    },
  }
}

/**
 * Answer one `POST /records/v1/<method>`: `{ status, json }`, or for an export
 * `{ status, bytes, contentType }`.
 */
export async function handleRecords(store, method, body, headers, runs = new Map()) {
  const who = actorFrom(headers)
  if (who.error) return { status: who.error.status, json: { error: { code: who.error.code, message: who.error.message, next: who.error.next } } }
  try {
    if (ROUTINE_METHODS.has(method)) return { status: 200, json: routines(method, body, who, runs) }
    // MEM_STUB_RECORDS_WITHOUT names methods to leave out, so a test can stand
    // in for an older records service (one before 0.9.5 has no forgotten.*).
    const without = new Set(String(process.env.MEM_STUB_RECORDS_WITHOUT ?? "").split(",").map((value) => value.trim()).filter(Boolean))
    if (without.has(method)) return { status: 404, json: { error: { code: "not_found", message: `no records method ${method}`, next: "use a method from the contract (§2.4)" } } }
    if (Object.hasOwn(JOB_METHODS, method)) {
      const runner = jobsOf(store)
      const fn = runner[JOB_METHODS[method]]
      if (typeof fn !== "function") return { status: 404, json: { error: { code: "not_found", message: `no records method ${method}`, next: "use a method from the contract (§2.4)" } } }
      const answer = method === "jobs.templates" ? fn() : await fn(who.space, body ?? {}, who.actor)
      return { status: 200, json: answer }
    }
    const name = METHODS[method]
    if (!name) return { status: 404, json: { error: { code: "not_found", message: `no records method ${method}`, next: "use a method from the contract (§2.4)" } } }
    const space = store.forSpace(who.space)
    const answer = await space[name](body ?? {}, who.actor)
    if (name === "exportTar") return { status: 200, bytes: Buffer.from(answer), contentType: "application/gzip" }
    return { status: 200, json: answer }
  } catch (error) {
    // The store's errors answer as the records server sends them:
    // `{error: {code, message, next, ...extra}}`, the extra keys (`current`,
    // `binding`, `id`, `reason`) inside `error`.
    if (typeof error?.toJSON === "function" && Number.isInteger(error?.status)) return { status: error.status, json: error.toJSON() }
    const status = Number(error?.status) || 500
    const code = typeof error?.code === "string" ? error.code : status === 500 ? "internal" : "error"
    const extra = error?.extra && typeof error.extra === "object" ? error.extra : {}
    return { status, json: { error: { code, message: String(error?.message ?? error), next: String(error?.next ?? ""), ...extra } } }
  }
}

function routines(method, body, who, runs) {
  const list = runs.get(who.space) ?? []
  if (method === "routines.status") return { runs: list.slice(-20) }
  if (!["admin", "owner"].includes(who.actor.role)) {
    throw Object.assign(new Error("running a routine needs the space's admin or owner"), { status: 403, code: "forbidden", next: "ask the space's owner" })
  }
  const routine = String(body?.routine ?? "")
  if (!ROUTINES.includes(routine)) {
    throw Object.assign(new Error(`routine must be one of ${ROUTINES.join(", ")}`), { status: 400, code: "invalid_request", next: "name a routine" })
  }
  const at = new Date().toISOString()
  const run = { routine, date: String(body?.date ?? at.slice(0, 10)), status: "skipped", tokens: 0, cost: 0, started: at, ended: at, error: "the stub runs no routines" }
  list.push(run)
  runs.set(who.space, list)
  return { run }
}
