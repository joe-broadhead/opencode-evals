/**
 * Access, enforced again in the service (contract §2.2, defence in depth).
 *
 * - Space roles rank viewer < editor < admin < owner.
 * - Role `grant` has no space role at all: it reaches only records whose path
 *   a grant covers. Memories, commitments and proposals have no path, so a
 *   grant never reaches them; neither does anything without a path (events,
 *   sources, stats, routines).
 * - The prefix rule (contract §3): a grant covers a path when `path === prefix`
 *   (a page), or when `prefix` ends in "/" and `path` starts with it (a
 *   folder). A grant on `people/ama` never covers `people/amanda` or
 *   `people/ama/notes`.
 */
import { forbidden, invalid } from "./errors.js"

export const ROLES = ["viewer", "editor", "admin", "owner"]
const RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 }
const GRANT_ROLES = new Set(["viewer", "editor"])
const PREFIX = /^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63}){0,3}\/?$/
const MAX_GRANTS = 100
const SPACE_KINDS = new Set(["personal", "shared"])
const CONTAINER = /^[A-Za-z0-9_.-]{1,128}$/
/** A core service id (the placement's `service_id`). */
export const SERVICE = /^[A-Za-z0-9_.:-]{1,200}$/
/** An identity issuer or subject: printable ASCII with no spaces, at most 200 characters. */
const IDENTITY_TEXT = /^[\x21-\x7e]{1,200}$/
const ZONES = new Map()

/**
 * Who the gateway verified this caller as
 * (docs/design/adr-verified-caller-grants.md §4.5): `person` or `agent`, the
 * issuer the credential was verified under, the member's subject, and — when
 * the credential names one — the host the request came through. A value that is
 * not a plain token is dropped, so a grant can never be bound to it.
 */
function normalizeIdentity(value) {
  if (!value || typeof value !== "object") return { principal: null, issuer: null, subject: null, host: null }
  const token = (candidate) => (typeof candidate === "string" && IDENTITY_TEXT.test(candidate) ? candidate : null)
  return {
    principal: value.principal === "person" || value.principal === "agent" ? value.principal : null,
    issuer: token(value.issuer),
    subject: token(value.subject),
    // The host the credential asserts (`hst_…`, a Jelly ID host id). A grant is
    // that host's, and only a request through it may spend the grant.
    host: token(value.host),
  }
}

/** True for an IANA time zone this runtime knows. */
export function isTimeZone(zone) {
  if (typeof zone !== "string" || !zone || zone.length > 80) return false
  if (!ZONES.has(zone)) {
    let ok = true
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone })
    } catch {
      ok = false
    }
    if (ZONES.size > 1000) ZONES.clear()
    ZONES.set(zone, ok)
  }
  return ZONES.get(zone)
}

/**
 * Check and copy an actor `{user, agent, session, role, grants, space, spaceKind, team, service, tz}`.
 * `space` is the control space id (the file's key), `spaceKind` personal or
 * shared, `team` the container id and `service` the core's service id (both
 * only recorded, for the routines' reads of the space's turns).
 * @returns {{user: string, agent: string|null, session: string|null, role: string, grants: Array<{prefix: string, role: string}>, space: string|null, spaceKind: "personal"|"shared"|null, team: string|null, service: string|null, tz: string|null, identity: {principal: "person"|"agent"|null, issuer: string|null, subject: string|null}}}
 */
export function normalizeActor(actor) {
  if (!actor || typeof actor !== "object") {
    throw forbidden("No caller was given, so nothing can be read or written.", "Send the request through the gateway, which sets the caller.")
  }
  const role = String(actor.role ?? "")
  if (role !== "grant" && !(role in RANK)) {
    throw invalid("invalid_role", `"${role}" is not a role.`, "The role is one of viewer, editor, admin, owner, or grant.")
  }
  const user = typeof actor.user === "string" && actor.user ? actor.user : null
  if (!user) throw invalid("invalid_actor", "The caller has no user id.", "Set x-records-user to the caller's memory user id.")
  let grants = []
  if (role === "grant") grants = normalizeGrants(actor.grants)
  const spaceKind = actor.spaceKind ?? null
  if (spaceKind !== null && !SPACE_KINDS.has(spaceKind)) {
    throw invalid("invalid_space_kind", `"${spaceKind}" is not a space kind.`, "The space kind is personal or shared.")
  }
  const team = actor.team ?? null
  if (team !== null && (typeof team !== "string" || !CONTAINER.test(team))) {
    throw invalid("invalid_team", "The caller's container id is not valid.", "Send x-records-team as 1 to 128 letters, digits, dots, hyphens or underscores.")
  }
  const service = actor.service ?? null
  if (service !== null && (typeof service !== "string" || !SERVICE.test(service))) {
    throw invalid("invalid_service", "The core service id is not valid.", "Send x-records-service as the placement's service id. The gateway sets it.")
  }
  const tz = actor.tz ?? null
  if (tz !== null && !isTimeZone(tz)) {
    throw invalid("invalid_scope", `"${tz}" is not an IANA time zone.`, "Send a zone such as Europe/London, or leave it out.")
  }
  // The spaces the caller may read, as the gateway resolved them: a copy into
  // any other space is a count only (SPEC-3 G7). Absent or malformed is no
  // list at all, so the read fails closed.
  const readableSpaces = Array.isArray(actor.readableSpaces)
    ? [...new Set(actor.readableSpaces.filter((id) => typeof id === "string" && id && id.length <= 128))]
    : []
  return {
    user,
    readableSpaces,
    agent: typeof actor.agent === "string" && actor.agent ? actor.agent : null,
    session: typeof actor.session === "string" && actor.session ? actor.session : null,
    role,
    grants,
    space: typeof actor.space === "string" && actor.space ? actor.space : null,
    spaceKind,
    team,
    service,
    tz,
    // "session" only when the gateway vouches that a person is acting in a
    // browser session of its console (x-records-credential); else "bearer".
    credential: actor.credential === "session" ? "session" : "bearer",
    // "agent" when the gateway authenticated an agent credential
    // (x-records-principal); else "user". Recorded in delete_audit (SEC-0912).
    principal: actor.principal === "agent" ? "agent" : "user",
    // The verified identity behind the credential (ADR §4.5): a grant acts
    // only for this member, from this issuer, and only for a person.
    identity: normalizeIdentity(actor.identity),
    // The routines' auto-apply mode, set in process by the routines (never
    // from a header: server.js builds actors without it). Only their user.
    autoApply: user === ROUTINE_USER && actor.autoApply === true,
    // The erase credential (RECORDS_ERASE_KEY), checked by the server against
    // its own setting. It is what lets person.erase run at all.
    erase: actor.erase === true,
    // The grant an act is applied under (§4.8), set in process by the act path
    // and never by a header: it is what makes history say `via: "grant"` and a
    // decision's `decided_via` "grant". Only the four fields are kept.
    grant: normalizeGrant(actor.grant),
  }
}

/** The grant fields a record's history keeps, or null (§4.8). */
function normalizeGrant(grant) {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) return null
  const text = (value) => (typeof value === "string" && value ? value : null)
  const host = text(grant.host)
  const jti = text(grant.jti)
  if (!host || !jti) return null
  return { host, jti, device: text(grant.device) ?? "", class: text(grant.class) ?? "chat" }
}

export function normalizeGrants(grants) {
  if (!Array.isArray(grants)) {
    throw invalid("invalid_grants", "A grant caller needs a list of grants.", 'Send x-records-grants as JSON, such as [{"prefix":"projects/harbour","role":"viewer"}].')
  }
  if (grants.length > MAX_GRANTS) throw invalid("invalid_grants", `At most ${MAX_GRANTS} grants are accepted.`, "Send only the grants on this space.")
  return grants.map((grant) => {
    const prefix = String(grant?.prefix ?? "")
    const role = String(grant?.role ?? "")
    if (!PREFIX.test(prefix)) {
      throw invalid("invalid_grants", `"${prefix}" is not a page or folder path.`, 'A grant prefix is a page path such as "projects/harbour", or a folder ending in "/".')
    }
    if (!GRANT_ROLES.has(role)) throw invalid("invalid_grants", `A grant's role is viewer or editor, not "${role}".`, "Send viewer or editor.")
    return { prefix, role }
  })
}

/** The prefix rule: the page itself, or anything under a folder prefix ending in "/". */
export function covers(prefix, path) {
  if (!path) return false
  return path === prefix || (prefix.endsWith("/") && path.startsWith(prefix))
}

export function rank(actor) {
  return RANK[actor.role] ?? 0
}

/** The space role is at least `min`. A grant caller has no space role. */
export function hasRole(actor, min) {
  return rank(actor) >= RANK[min]
}

export function canRead(actor, path) {
  if (rank(actor) >= RANK.viewer) return true
  return actor.role === "grant" && Boolean(path) && actor.grants.some((grant) => covers(grant.prefix, path))
}

export function canWrite(actor, path) {
  if (rank(actor) >= RANK.editor) return true
  return actor.role === "grant" && Boolean(path) && actor.grants.some((grant) => grant.role === "editor" && covers(grant.prefix, path))
}

const NEEDS = {
  viewer: "read this space",
  editor: "write to this space",
  admin: "manage this space",
  owner: "do this in this space",
}

/** Throw 403 unless the actor's space role is at least `min`. */
export function requireRole(actor, min, what) {
  if (hasRole(actor, min)) return
  const by = actor.role === "grant" ? "a page or folder grant, which only reaches pages under its path" : `the ${actor.role} role`
  throw forbidden(
    `${what ?? `This needs the ${min} role to ${NEEDS[min]}`}; you have ${by}.`,
    min === "admin" || min === "owner"
      ? "Ask an admin or the owner of this space to do it."
      : "Ask a space admin for the role, or use a page you were granted.",
  )
}

/**
 * The SQL that limits a query to what a grant caller may read, with its
 * parameters, or null for a caller with a space role. A grant caller with no
 * grants sees nothing.
 * @returns {{sql: string, params: Array<string|number>} | null}
 */
export function visibilityClause(actor, column = "path") {
  if (rank(actor) >= RANK.viewer) return null
  if (actor.role !== "grant" || actor.grants.length === 0) return { sql: "0", params: [] }
  const parts = []
  const params = []
  for (const grant of actor.grants) {
    if (grant.prefix.endsWith("/")) {
      parts.push(`substr(${column}, 1, ?) = ?`)
      params.push(grant.prefix.length, grant.prefix)
    } else {
      parts.push(`${column} = ?`)
      params.push(grant.prefix)
    }
  }
  return { sql: `(${column} is not null and (${parts.join(" or ")}))`, params }
}

/**
 * The routines' own user. Its writes never set a journal's `edited` and it is
 * never recorded as a personal space's `owner_user`.
 */
export const ROUTINE_USER = "routines"

/**
 * Memory's job runner's own user (records/src/jobs). Like the routines it is a
 * system principal: it is never recorded as a personal space's `owner_user`,
 * and writing as it never creates a space.
 */
export const JOBS_USER = "jobs"

/**
 * The principals the records service acts as itself. Their actors are made in
 * process, and the access rules read them as the service, so no caller that
 * arrives over HTTP may claim one (0.10 review: a caller named `jobs` holding a
 * grant to another person's personal space could rewrite a page there).
 */
export const RESERVED_USERS = Object.freeze([ROUTINE_USER, JOBS_USER])

/** An actor for the routines' own reads and writes: the space's owner role. */
export const SYSTEM_ACTOR = Object.freeze({
  user: ROUTINE_USER,
  agent: "routines",
  session: null,
  role: "owner",
  grants: [],
  space: null,
  spaceKind: null,
  team: null,
  service: null,
  tz: null,
})
