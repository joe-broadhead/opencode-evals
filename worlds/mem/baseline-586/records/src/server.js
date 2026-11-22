/**
 * memory-records over HTTP (contract §2.2): `POST /v1/<method>` with a JSON
 * body, `GET /health` without auth.
 *
 * - Auth: `authorization: Bearer <RECORDS_API_KEY>`, compared in constant time.
 * - Scope: the `x-records-*` headers the gateway sets become the store's actor;
 *   the store enforces the role again.
 * - Errors: `{error: {code, message, next}}`.
 * - The file is keyed by `x-records-space` (the control space id), never by
 *   `x-records-team` (the container, which legacy personal spaces share).
 * - Logs: one JSON line per request (method, a hash of the space id, status,
 *   ms), never a body or a header value.
 *
 * Run: `RECORDS_API_KEY=… node src/server.js`.
 */
import { createHash, timingSafeEqual } from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import { fileURLToPath, pathToFileURL } from "node:url"
import { RESERVED_USERS, ROLES, SERVICE, isTimeZone, normalizeGrants, requireRole } from "./access.js"
import { createActionKeys } from "./action-grant-keys.js"
import { createActs } from "./acts.js"
import { jobsOffReason, loadConfig, routinesOffReason } from "./config.js"
import { RecordsError, forbidden, invalid, tooLarge, unavailable } from "./errors.js"
import { SPACE_ID, TEAM_ID, isRecordsError, openStore } from "./store.js"
import { createModelGuard } from "./model-guard.js"
import { snapshotSpace, installSpace, initializeSpace, retargetSpace } from "./space-ops.js"
import { createPersonCoreEraser, createPersonRowsEraser } from "./person-core.js"
import { diskUsed } from "./engine/metrics.js"

const KIB = 1024
const BODY_LIMIT = 1024 * KIB
const INGEST_LIMIT = 8 * 1024 * KIB
const SNAPSHOT_LIMIT = 128 * 1024 * KIB
const SPACE_OPS = new Set(["space.snapshot", "space.install", "space.verify", "space.initialize", "space.retarget"])

/** True when the request carries the erase credential, in constant time. */
function eraseAuthorized(req, eraseKey) {
  if (!eraseKey) return false
  const given = req.headers["x-records-erase-key"]
  if (typeof given !== "string" || !given) return false
  const left = Buffer.from(given)
  const right = Buffer.from(eraseKey)
  return left.length === right.length && timingSafeEqual(left, right)
}

/** API method → SpaceStore method. */
export const METHODS = {
  "agents.seen": "agentsSeen",
  "agents.mine": "agentsMine",
  "sessions.seen": "sessionsSeen",
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
  "records.copied": "noteCopies",
  "records.copies": "copies",
  "events.ingest": "ingestEvents",
  "events.cursor": "eventsCursor",
  "events.list": "listEvents",
  "events.forget": "forgetEvents",
  "sources.list": "listSources",
  "sources.bind": "bindSource",
  "sources.unbind": "unbindSource",
  "sources.import": "importHistory",
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
  "plugins.cancel": "cancelPlugin",
  "review.list": "listProposals",
  "review.decide": "decideProposal",
  "review.edit": "editHeldWrite",
  "proposals.create": "createProposal",
  "proposals.askChanges": "askProposalChanges",
  "space.stats": "stats",
  // What this space has stopped suggesting (#77): the kinds a person turned off
  // with `suggestion.dismiss { forever: true }`, names only.
  "space.suggestion-optouts": "suggestionOptouts",
  // Turning one back on (#77): the console's own door, a browser session's, and
  // no Jelly action: a person who said "never suggest this" can change their
  // mind in Memory's console.
  "space.suggestion-optin": "suggestionOptin",
  "space.purge": "purge",
  "person.erase": "personErase",
  // The person's audit and knowledge rows alone, its own step of an erasure.
  "person.eraseCore": "personEraseCore",
  "forgotten.put": "putForgotten",
  "forgotten.list": "listForgotten",
  "forgotten.lift": "liftForgotten",
  "forgotten.match": "matchForgotten",
  "forgotten.check": "checkForgotten",
  // What a preview showed a person, for the press that follows (0.11): the
  // fields a host never sends back. A row in `act_previews`, spent once by the
  // press (`acts.apply`) and expired after a few minutes.
  "acts.preview": "recordPreview",
}
const ROUTINE_METHODS = new Set(["routines.run", "routines.status"])
/** The job runner's methods (DESIGN-MEMORY-JOBS §12, J0): each one names a createJobs method. */
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
  // 0.11: proposals from a meeting page (opencode-mem#58 item 2).
  "jobs.meetings": "meetings",
})
const JOB_SET = new Set(Object.keys(JOB_METHODS))
const ROUTINE_NAMES = ["daily", "weekly", "monthly", "lint", "dashboard"]
/**
 * The methods of the grant door (ADR §4.6): `acts.apply` applies an act a person
 * chose in their host's UI, and `acts.settle` completes one whose change spans
 * services, once it has happened.
 */
const GRANT_METHODS = new Set(["acts.apply", "acts.settle"])

export function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version ?? "0.0.0"
  } catch {
    return "0.0.0"
  }
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest()
}

/** A short, stable hash of a space id for logs: enough to correlate, not to read. */
export function spaceHash(space) {
  return space ? createHash("sha256").update(space).digest("hex").slice(0, 12) : null
}

function jsonLog(line) {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), ...line })}\n`)
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    ...(res.closeAfter ? { connection: "close" } : {}),
  })
  res.end(body)
}

function header(req, name) {
  const value = req.headers[name]
  return Array.isArray(value) ? value[0] : value
}

/** The space id and the actor from the gateway's scope headers (§2.2), or a 400. */
export function actorFromHeaders(req) {
  const space = header(req, "x-records-space")
  if (!space || !SPACE_ID.test(space)) {
    throw invalid("invalid_space", "x-records-space is missing or not a space id.", "Send the control space id: 1 to 128 letters, digits, dots, hyphens or underscores. The gateway sets it.")
  }
  const spaceKind = header(req, "x-records-space-kind")
  if (spaceKind !== "personal" && spaceKind !== "shared") {
    throw invalid("invalid_space_kind", `x-records-space-kind is ${spaceKind ? `"${spaceKind}"` : "missing"}.`, "Send personal or shared. The gateway sets it.")
  }
  const team = header(req, "x-records-team")
  if (!team || !TEAM_ID.test(team)) {
    throw invalid("invalid_team", "x-records-team is missing or not a container id.", "Send the space's team_id: 1 to 128 letters, digits, dots, hyphens or underscores. The gateway sets it.")
  }
  const service = header(req, "x-records-service")
  if (!service || !SERVICE.test(service)) {
    throw invalid("invalid_service", "x-records-service is missing or not a service id.", "Send the core's service id for this space (the placement's service_id). The gateway sets it.")
  }
  const required = (name) => {
    const value = header(req, name)
    if (!value || value.length > 200) throw invalid("invalid_scope", `${name} is missing or longer than 200 characters.`, `Send ${name}; the gateway sets it from the resolved context.`)
    return value
  }
  const optional = (name) => {
    const value = header(req, name)
    if (value === undefined || value === "") return null
    if (value.length > 200) throw invalid("invalid_scope", `${name} is longer than 200 characters.`, `Send a shorter ${name}, or leave it out.`)
    return value
  }
  const user = required("x-records-user")
  // A service principal is not a person (0.10 review of the 0.9.14 merge): the
  // service acts as `jobs` and `routines` itself, in process, and the access
  // rules read either one as the service. A caller that arrives here claiming
  // one would be taken for it — with a grant to another person's personal
  // space it could rewrite a page there — so the identity is refused before
  // any method runs. The gateway makes the user id, and never names these.
  if (RESERVED_USERS.includes(user)) {
    throw forbidden(`"${user}" is a service principal, not a person.`, "Send the caller's own memory user id. The gateway sets it, and it never names a system principal.")
  }
  const role = header(req, "x-records-role")
  if (role !== "grant" && !ROLES.includes(role)) {
    throw invalid("invalid_role", `x-records-role is ${role ? `"${role}"` : "missing"}.`, "Send viewer, editor, admin, owner, or grant.")
  }
  let grants = []
  if (role === "grant") {
    const raw = header(req, "x-records-grants")
    let parsed
    try {
      parsed = JSON.parse(raw ?? "")
    } catch {
      throw invalid("invalid_grants", "x-records-grants is missing or not JSON.", 'With role grant, send x-records-grants such as [{"prefix":"projects/harbour","role":"viewer"}].')
    }
    grants = normalizeGrants(parsed)
  }
  // The spaces the caller may read, resolved by the gateway from the control
  // context: a copy into any other space is a count only (SPEC-3 G7). The list
  // is the gateway's own, never a client value; a malformed one is refused.
  let readableSpaces = []
  const spacesHeader = header(req, "x-records-read-spaces")
  if (spacesHeader !== undefined && spacesHeader !== "") {
    let parsed
    try {
      parsed = JSON.parse(spacesHeader)
    } catch {
      throw invalid("invalid_scope", "x-records-read-spaces is not JSON.", "Send the caller's space ids as a JSON array; the gateway sets it.")
    }
    if (!Array.isArray(parsed) || parsed.length > 500 || parsed.some((id) => typeof id !== "string" || !SPACE_ID.test(id))) {
      throw invalid("invalid_scope", "x-records-read-spaces is not a list of space ids.", "Send the caller's space ids as a JSON array; the gateway sets it.")
    }
    readableSpaces = parsed
  }
  const tz = optional("x-records-tz")
  if (tz && !isTimeZone(tz)) {
    throw invalid("invalid_scope", `x-records-tz "${tz}" is not an IANA time zone.`, "Send a zone such as Europe/London, or leave it out.")
  }
  // x-records-principal: `person` or `agent`, as the gateway verified the
  // credential. Any other value is no principal at all, so an act is refused.
  const principalHeader = optional("x-records-principal")
  const identityPrincipal = principalHeader === "person" || principalHeader === "agent" ? principalHeader : null
  return {
    space,
    // x-records-credential: "session" when the gateway's console acts for a
    // person in a browser session (cookie, CSRF and Origin checked there);
    // only the gateway holds RECORDS_API_KEY, so only it can say so.
    actor: {
      user,
      agent: optional("x-records-agent"),
      session: optional("x-records-session"),
      role,
      grants,
      readableSpaces,
      space,
      spaceKind,
      team,
      service,
      tz,
      credential: optional("x-records-credential") === "session" ? "session" : "bearer",
      principal: optional("x-records-principal") === "agent" ? "agent" : "user",
      // Who the gateway verified this caller as (ADR §4.5). A grant acts only
      // for this member, through this issuer, and — when the credential names
      // one — only from this host: the four are the gateway's own, built from
      // the verified credential and never copied from a request.
      identity: {
        principal: identityPrincipal,
        issuer: optional("x-records-identity-issuer"),
        subject: optional("x-records-identity-subject"),
        host: optional("x-records-identity-host"),
      },
    },
  }
}

/**
 * Read a JSON object body of at most `limit` bytes. An oversize body is read
 * to its end and dropped before the 413, up to 4 times the limit, so the
 * client sees the answer rather than a reset mid-upload; beyond that the
 * connection is closed after the answer.
 */
async function readJson(req, res, limit) {
  const next = limit === INGEST_LIMIT ? "Send fewer events per call." : "Send less in one call: split large pages, or page through lists."
  const ceiling = limit * 4
  const declared = Number(header(req, "content-length"))
  if (Number.isFinite(declared) && declared > ceiling) {
    res.closeAfter = true
    throw tooLarge(`The body is ${declared} bytes; this method takes at most ${limit} bytes.`, next)
  }
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > ceiling) {
      res.closeAfter = true
      break
    }
    if (size <= limit) chunks.push(chunk)
  }
  if (size > limit) throw tooLarge(`The body is over ${limit} bytes; this method takes at most ${limit} bytes.`, next)
  const text = Buffer.concat(chunks).toString("utf8").trim()
  if (!text) return {}
  let body
  try {
    body = JSON.parse(text)
  } catch {
    throw invalid("invalid_json", "The body is not valid JSON.", "Send a JSON object, such as {\"query\": \"…\"}.")
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw invalid("invalid_body", "The body must be a JSON object.", "Wrap the arguments in {…}.")
  }
  return body
}

/** An error that carries its own answer: the store's, or the routines' (status, code, message, next). */
function answerOf(error) {
  if (isRecordsError(error)) return { status: error.status, payload: error.toJSON() }
  if (Number.isInteger(error?.status) && error.status >= 400 && error.status < 600 && typeof error?.code === "string") {
    return {
      status: error.status,
      payload: { error: { code: error.code, message: String(error.message ?? error.code), next: typeof error.next === "string" ? error.next : "Check the request against the records API." } },
    }
  }
  return null
}

function isBusy(error) {
  return /SQLITE_BUSY|database is locked/i.test(String(error?.message ?? "")) || error?.errcode === 5
}

/**
 * @param {{config: {apiKey: string}, store: ReturnType<typeof openStore>, routines?: {run: Function, status: Function} | null, log?: (line: object) => void, version?: string}} options
 */
export function createRecordsServer({ config, store, routines = null, jobs = null, engine = null, log = jsonLog, version = readVersion() }) {
  if (!config?.apiKey) throw new Error("createRecordsServer: config.apiKey is required")
  const keyDigest = digest(config.apiKey)

  function authorized(req) {
    const value = header(req, "authorization") ?? ""
    const match = /^Bearer\s+(.+)$/i.exec(value)
    // Compare digests, so the comparison takes the same time whatever the length.
    return Boolean(match) && timingSafeEqual(digest(match[1].trim()), keyDigest)
  }

  async function dispatch(method, space, actor, body) {
    if (GRANT_METHODS.has(method)) {
      // The grant door: the store verifies the grant again, binds it to the
      // caller and spends it in the act's transaction (ADR §4.6, §4.8). A
      // settle completes a reservation whose change spans services.
      return { json: method === "acts.settle" ? await store.forSpace(space).settleGrant(body, actor) : await store.forSpace(space).applyGrant(body, actor) }
    }
    if (SPACE_OPS.has(method)) {
      requireRole(actor, "admin", "Space operations need an operator")
      if (method === "space.initialize") return { json: initializeSpace(store, space, actor) }
      if (method === "space.retarget") return { json: retargetSpace(store, space, actor) }
      if (method === "space.install") return { json: await installSpace(store, space, body) }
      const snapshot = await snapshotSpace(store, space, { includeData: method !== "space.verify" })
      return { json: snapshot }
    }
    if (JOB_SET.has(method)) {
      // `RECORDS_JOBS=off` takes the whole runner out of the service: no method
      // can claim, finish or write, not just the tick (review item 3).
      if (!jobs) {
        throw unavailable("jobs_disabled", "Memory Jobs are off in this service (RECORDS_JOBS=off, or no jobs module).", "Set RECORDS_JOBS=on where the job runner should run, or leave jobs to the service that has it.")
      }
      const fn = JOB_METHODS[method]
      if (method === "jobs.templates") return { json: jobs.template() }
      return { json: await jobs[fn](space, body, actor) }
    }
    if (ROUTINE_METHODS.has(method)) {
      if (!routines) {
        throw unavailable("routines_unavailable", "Routines are not part of this service build.", "Write journal and dashboard pages with records.put, or ask the operator to deploy a build with routines.")
      }
      if (method === "routines.run") {
        requireRole(actor, "admin", "Running a routine needs the admin or owner role")
        if (!ROUTINE_NAMES.includes(body.routine)) {
          throw invalid("invalid_routine", `"${body.routine}" is not a routine.`, `Send routine as one of ${ROUTINE_NAMES.join(", ")}.`)
        }
        if (body.date !== undefined && (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))) {
          throw invalid("invalid_request", "date must be YYYY-MM-DD.", "Send the local day to run for, or leave it out for today.")
        }
        return { json: { run: await routines.run(space, body.routine, body.date ?? null, actor) } }
      }
      requireRole(actor, "viewer", "Routine status needs a role in this space")
      const status = await routines.status(space)
      return { json: Array.isArray(status) ? { runs: status } : status }
    }
    const result = await store.forSpace(space)[METHODS[method]](body, actor)
    if (method === "records.export") return { gzip: result }
    return { json: result }
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? "/", "http://records.invalid")
    // The engine's metrics and pages (plan §4): the cell's own counters, the
    // ready index and the disk. With no engine it answers an empty set.
    if (url.pathname === "/metrics" && (req.method === "GET" || req.method === "HEAD")) {
      if (!authorized(req)) {
        req.resume()
        throw new RecordsError(401, "unauthorized", "The request has no valid bearer key.", "Send Authorization: Bearer <the cell's records key>.")
      }
      return { status: 200, json: engine?.metrics?.() ?? { ok: true, pages: [] } }
    }
    if (url.pathname === "/health") {
      if (req.method !== "GET" && req.method !== "HEAD") {
        throw invalid("invalid_method", "/health answers GET.", "Send GET /health.")
      }
      return { status: 200, json: { ok: true, version, spaces: store.spaceIds().length, ...(typeof store.idempotentReplay === "function" ? { idempotent_replay: store.idempotentReplay() } : {}) } }
    }
    // A method name is `namespace.verb`; the verb may carry a capital
    // (`proposals.askChanges`), and METHODS is the allowlist that decides what
    // runs, so this only has to admit the shape.
    const match = /^\/v1\/([a-z]+\.[a-zA-Z]+)$/.exec(url.pathname)
    if (!authorized(req)) {
      req.resume()
      throw new RecordsError(401, "unauthorized", "The request has no valid bearer key.", "Send Authorization: Bearer <the cell's records key>. The gateway adds it; clients go through the gateway.")
    }
    const method = match?.[1]
    if (!method || (!(method in METHODS) && !ROUTINE_METHODS.has(method) && !JOB_SET.has(method) && !SPACE_OPS.has(method) && !GRANT_METHODS.has(method))) {
      req.resume()
      throw new RecordsError(404, "not_found", `${url.pathname} is not a records method.`, `Call POST /v1/<method> with one of: ${[...Object.keys(METHODS), ...ROUTINE_METHODS, ...JOB_SET, ...GRANT_METHODS].join(", ")}.`)
    }
    if (req.method !== "POST") {
      req.resume()
      throw invalid("invalid_method", `${method} is called with POST, not ${req.method}.`, `Send POST /v1/${method} with a JSON body.`)
    }
    const { space, actor } = actorFromHeaders(req)
    // The erase credential is separate from the cell key: a records key alone
    // can read and write a space, and must not erase a person.
    actor.erase = eraseAuthorized(req, config.eraseKey)
    res.locals = { method, space }
    const body = await readJson(req, res, method === "space.install" ? SNAPSHOT_LIMIT : method === "events.ingest" ? INGEST_LIMIT : BODY_LIMIT)
    const result = await dispatch(method, space, actor, body)
    return { status: 200, ...result }
  }

  const server = http.createServer(async (req, res) => {
    const started = performance.now()
    let status = 500
    try {
      const out = await handle(req, res)
      status = out.status
      if (out.gzip) {
        res.writeHead(200, {
          "content-type": "application/gzip",
          "content-length": out.gzip.length,
          "content-disposition": 'attachment; filename="records-export.tar.gz"',
          "cache-control": "no-store",
        })
        res.end(out.gzip)
      } else {
        send(res, status, out.json)
      }
    } catch (error) {
      const answer = answerOf(error)
      if (answer) {
        status = answer.status
        send(res, status, answer.payload)
      } else if (isBusy(error)) {
        status = 503
        send(res, status, unavailable("busy", "The space's file is busy (a backup or a long write).", "Retry in a second.").toJSON())
      } else {
        status = 500
        log({ level: "error", msg: "records.error", method: res.locals?.method ?? null, space: spaceHash(res.locals?.space), error: String(error?.message ?? error).slice(0, 300) })
        send(res, status, { error: { code: "internal", message: "The records service failed on this request.", next: "Retry once; if it fails again, report it with the time of the request." } })
      }
    } finally {
      if (!(req.url ?? "").startsWith("/health") || status !== 200) {
        log({
          level: "info",
          msg: "request",
          method: res.locals?.method ?? (req.url ?? "").split("?")[0].slice(0, 80),
          space: spaceHash(res.locals?.space),
          status,
          ms: Math.round((performance.now() - started) * 10) / 10,
        })
      }
    }
  })
  server.headersTimeout = 30_000
  server.requestTimeout = 120_000

  return {
    server,
    /** Listen; resolves with the bound port. */
    listen(port = 0, host = "127.0.0.1") {
      return new Promise((resolve, reject) => {
        server.once("error", reject)
        server.listen(port, host, () => {
          server.off("error", reject)
          resolve(server.address().port)
        })
      })
    },
    /** Stop accepting, let in-flight requests finish, close idle keep-alive sockets. */
    close() {
      return new Promise((resolve) => {
        server.close(() => resolve())
        server.closeIdleConnections?.()
      })
    },
  }
}

/**
 * Load the routines module when this build has one (lane ROUT owns
 * `src/routines/`). It reads its own settings with its `configFromEnv` when it
 * exports one; otherwise it gets this service's configuration.
 */
export async function loadRoutines({ store, config, log, env = process.env, guard = null, engine = null, url = new URL("./routines/index.js", import.meta.url) }) {
  if (!fs.existsSync(fileURLToPath(url))) return null
  const module = await import(url.href)
  if (typeof module.createRoutines !== "function") return null
  const settings = typeof module.configFromEnv === "function" ? module.configFromEnv(env) : config
  return module.createRoutines({ store, config: settings, log, guard, engine })
}

/**
 * Load the engine when this build has one and a deployment turned it on (S3a,
 * docs/design/s3-engine-plan.md §1). It is a leaf beside the routines, with the
 * **same** `guard`: one breaker and one cell's day. With `RECORDS_ENGINE=off`
 * nothing is loaded and nothing is written, so production is unchanged.
 */
export async function loadEngine({ store, config, log = null, env = process.env, guard = null, llm = null, url = new URL("./engine/index.js", import.meta.url) }) {
  if (!config.engine || config.engine === "off") return null
  if (!fs.existsSync(fileURLToPath(url))) return null
  const module = await import(url.href)
  if (typeof module.createEngine !== "function") return null
  return module.createEngine({
    store,
    log,
    guard,
    llm,
    env,
    config: { engine: config.engine, cohort: config.engineSpaces, shadowTokens: config.engineShadowTokens, retentionDays: config.eventRetentionDays, batchChars: config.routineBatchChars, canarySpace: config.canarySpace, serviceTokens: config.serviceBudgetTokens, maxOpen: config.maxOpen },
  })
}

/**
 * Load the job runner when this build has one (records/src/jobs). Missing is
 * not an error: a build without it refuses jobs.* with `jobs_unavailable`.
 */
export async function loadJobs({ store, config, log, guard = null, url = new URL("./jobs/index.js", import.meta.url) }) {
  if (jobsOffReason(config)) return null
  if (!fs.existsSync(fileURLToPath(url))) return null
  const module = await import(url.href)
  if (typeof module.createJobs !== "function") return null
  // The job runner's extract engine and its meeting-page proposals call the
  // same model the routines do, with the same key. Both are off unless a
  // deployment turned them on: `extract` saves nothing directly, and proposing
  // from a meeting page is gated on its held-out set (owner, round 10).
  // A model client only for a feature that is on.
  const wantsModel = config.jobsConfig?.extract === "on" || config.jobsConfig?.meetingProposals === "on"
  const llm =
    config.llmUrl && config.llmModel && wantsModel
      ? (await import("./routines/llm.js")).createLlm({ url: config.llmUrl, model: config.llmModel, key: config.llmKey, log })
      : null
  return module.createJobs({ store, config: { ...(config.jobsConfig ?? {}) }, log, llm, guard })
}

const DAY_MS = 24 * 60 * 60 * 1000

/** Retention for every space: once at start, then daily. Returns the timer (unref'd). */
/**
 * The disk's own check (plan §4): whatever the engine flag, every ten minutes,
 * and a page at 70%. It runs beside the housekeeping because a full disk is the
 * service's problem, not the engine's.
 */
export function startDiskWatch({ dataDir, log, everyMs = 10 * 60_000, used = null }) {
  const check = () => {
    const disk = (used ?? diskUsed)(dataDir)
    if (!disk) return null
    if (disk.ratio >= 0.7) log({ level: "error", msg: "memory.records.disk", ratio: Math.round(disk.ratio * 1000) / 1000, used: disk.used, total: disk.total, next: "Free space, or move the space files to a larger volume." })
    return disk
  }
  void check()
  const timer = setInterval(check, Math.max(60_000, everyMs))
  timer.unref()
  return timer
}

export function startHousekeeping({ store, log, everyMs = DAY_MS }) {
  const sweep = async () => {
    try {
      const done = await store.maintainAll()
      log({ level: "info", msg: "records.housekeeping", ...done })
    } catch (error) {
      log({ level: "error", msg: "records.housekeeping", error: String(error?.message ?? error).slice(0, 300) })
    }
  }
  void sweep()
  const timer = setInterval(sweep, everyMs)
  timer.unref()
  return timer
}

/**
 * The records service's own removal worker (0.11 review R7): every few seconds
 * it finishes what a source removal left behind — an unfinished citation index,
 * then pending retractions — a bounded slice per space, in the spaces that said
 * they have work. It runs here, not in the collector, so a deletion finishes
 * whether or not OpenCode is running and whatever the collector's cadence is;
 * the timer is unref'd and cleared on shutdown.
 */
export function startRemovalWorker({ store, log, everyMs = 10_000 }) {
  let running = false
  const tick = async () => {
    if (running) return
    running = true
    try {
      const done = await store.drainOnce()
      if (done.slices > 0) log({ level: "info", msg: "records.removals", ...done })
    } catch (error) {
      log({ level: "error", msg: "records.removals", error: String(error?.message ?? error).slice(0, 300) })
    } finally {
      running = false
    }
  }
  const timer = setInterval(() => void tick(), everyMs)
  timer.unref()
  return timer
}

export async function main(env = process.env) {
  let config
  try {
    config = loadConfig(env)
  } catch (error) {
    jsonLog({ level: "error", msg: "records.config", error: error.message })
    process.exit(1)
  }
  const log = jsonLog
  for (const warning of config.warnings ?? []) log({ level: "warn", msg: "records.config", warning })
  // The action keys are public, read from a file (§4.3): at start, on SIGHUP,
  // and on the act path when the file changes. With no file, no act verifies.
  const actionKeys = createActionKeys({
    file: config.actionKeysFile,
    audience: config.actionAudience,
    maxAgeMs: config.actionKeysMaxAgeMs,
    log,
  })
  const store = openStore({
    dataDir: config.dataDir,
    eventRetentionDays: config.eventRetentionDays,
    // The LRU's size, which the service never passed before (plan §4).
    maxOpen: config.maxOpen,
    proposalTtlDays: config.proposalTtlDays,
    heldReceiptKey: config.heldReceiptKey,
    forgetSecret: config.forgetSecret,
    receiptTtlMs: config.receiptTtlHours * 3_600_000,
    receiptMax: config.receiptMax,
    actKeys: actionKeys,
    actAudience: config.actionAudience,
    acts: createActs(),
    actsEnabled: config.actionsEnabled,
    personCore: createPersonCoreEraser({
      url: config.coreUrl,
      key: config.coreKey,
      knowledgeUrl: config.knowledgeUrl,
      knowledgeKey: config.knowledgeKey,
      serviceId: config.env?.RECORDS_CORE_SERVICE_ID,
    }),
    personRows: createPersonRowsEraser({
      url: config.coreUrl,
      key: config.coreKey,
      serviceId: config.env?.RECORDS_CORE_SERVICE_ID,
    }),
    p2Key: config.p2Key,
    engine: config.engine,
  })
  process.on("SIGHUP", () => {
    actionKeys.reload()
  })
  // One model budget and one breaker per space, for the routines and the job
  // runner together (0.11): the day is `RECORDS_BUDGET_TOKENS` over both
  // ledgers, and one breaker stops both.
  const guard = createModelGuard({
    store,
    log,
    config: { limit: config.budgetTokens, breakerFailures: config.modelBreaker?.breakerFailures, breakerCooldownMs: config.modelBreaker?.breakerCooldownMs },
  })
  // The routines read their keys from the environment with *_FILE resolved once (config.env).
  // The engine is a leaf beside the routines, with the same guard (S3a). In
  // shadow it also gets the model the routines use: it reads the cohort only,
  // and writes `engine_shadow` only (S3b). It is loaded first so the routines'
  // status can show its pauses (S3c).
  const engineLlm =
    config.engine === "shadow" && config.llmUrl && config.llmModel
      ? (await import("./routines/llm.js")).createLlm({ url: config.llmUrl, model: config.llmModel, key: config.llmKey, log })
      : null
  const engine = await loadEngine({ store, config, log, env: config.env, guard, llm: engineLlm })
  const routines = await loadRoutines({ store, config, log, env: config.env, guard, engine: () => engine })
  const jobs = await loadJobs({ store, config, log, guard })
  const app = createRecordsServer({ config, store, routines, jobs, engine, log })
  const port = await app.listen(config.port, config.bind)
  log({ level: "info", msg: "records.listening", port, bind: config.bind, version: readVersion(), spaces: store.spaceIds().length })
  log({
    level: "info",
    msg: "records.act_grants",
    state: actionKeys.available() ? "on" : "off",
    keys: actionKeys.current().entries.length,
    stale: actionKeys.stale(),
    acts: config.actionsEnabled,
    ...(actionKeys.problem() ? { problem: actionKeys.problem() } : {}),
  })
  const housekeeping = startHousekeeping({ store, log })
  // The disk, whatever the engine flag (plan §4).
  const disk = startDiskWatch({ dataDir: config.dataDir, log })
  // Removals finish on the service's own clock, not the collector's (R7).
  const removals = startRemovalWorker({ store, log, everyMs: config.removalEveryMs ?? 10_000 })
  const off = routines ? routinesOffReason(config) : "this build has no routines module"
  if (routines && !off) {
    await routines.start?.()
    log({ level: "info", msg: "records.routines", state: "on" })
  } else {
    log({ level: "info", msg: "records.routines", state: "off", reason: off })
  }
  if (jobs) {
    jobs.start?.()
    log({ level: "info", msg: "records.jobs", state: "on" })
  } else {
    log({ level: "info", msg: "records.jobs", state: "off", reason: jobsOffReason(config) ?? "this build has no jobs module" })
  }
  // The engine's ingest half runs inside ingest; this line says which mode the
  // cell is in, so a log reader never guesses (S3a).
  if (engine) {
    log({ level: "info", msg: "records.engine", state: "on", mode: engine.mode, cohort: engine.cohort.size })
    // Shadow's own clock: it reads the ready index, and only the cohort.
    if (engine.shadow) log({ level: "info", msg: "records.engine.shadow", started: engine.start?.() ?? false })
  } else log({ level: "info", msg: "records.engine", state: "off", reason: "RECORDS_ENGINE is off" })
  let stopping = false
  const stop = async (signal) => {
    if (stopping) return
    stopping = true
    log({ level: "info", msg: "records.shutdown", signal })
    setTimeout(() => process.exit(1), 10_000).unref()
    clearInterval(housekeeping)
    clearInterval(disk)
    clearInterval(removals)
    try {
      await routines?.stop?.()
      engine?.stop?.()
      jobs?.stop?.()
      await app.close()
    } finally {
      store.close()
      process.exit(0)
    }
  }
  process.on("SIGTERM", () => void stop("SIGTERM"))
  process.on("SIGINT", () => void stop("SIGINT"))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main()
}
