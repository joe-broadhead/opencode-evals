import { createHash } from "node:crypto"
import http from "node:http"
import { recordsHeaders } from "./records-world.mjs"
import { CONTROL_TOKEN, CONTROL_SPACES, OTHER_SPACE, CONTROL_USERS, trackCleanup } from "./harness-state.mjs"

function publicSpace(space) {
  return { space_id: space.spaceId, name: space.name, kind: space.kind, role: space.role }
}

function jsonResponse(response, status, value) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" })
  response.end(JSON.stringify(value))
}

function readRequestBody(request, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on("data", (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(Object.assign(new Error("request body too large"), { status: 413 }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8")
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(Object.assign(new Error("invalid JSON body"), { status: 400 }))
      }
    })
    request.on("error", reject)
  })
}

/**
 * Fake spaces control plane.
 *
 * It exposes only public space fields on `/v1/spaces`. `/v1/context` additionally
 * returns the placement container id, which the plugin legitimately needs to
 * address the stub. A session is bound the first time the plugin sends a
 * session_id; later context calls use that binding until a different space is
 * explicitly requested.
 *
 * @param {{ defaultSpace?: "personal" | "shared", spaces?: typeof CONTROL_SPACES, token?: string, recordsURL?: string }} [options]
 */
export async function startControlServer(options = {}) {
  const spaces = options.spaces ?? CONTROL_SPACES
  const defaultKey = options.defaultSpace === "shared" ? "shared" : "personal"
  const token = options.token ?? CONTROL_TOKEN
  const bindings = new Map()
  const requests = []
  // 0.9.0 sharing (contract §3): pages and folders are `wiki_page` resources
  // with `upstream_id` `records:<path>` or `records:<prefix>/`, granted with the
  // existing grants. The fake keeps them in memory and hands them to the
  // scorer as state (`resources`, `grants`, `controlLog`).
  // A mutable copy per server, because a rename stores its new name here as
  // the real control updates its row (`space-manage.js`, `updateName`) and
  // every later read must return it (0.10.0 gate adjudication, note 2). The
  // seeded spaces are frozen and shared across attempts, so copying keeps one
  // attempt's rename out of the next one's world.
  const allSpaces = new Map([...Object.values(spaces), OTHER_SPACE].map((space) => [space.spaceId, { ...space }]))
  /** The live copy of a seeded space, by its key. */
  const liveSpace = (key) => (spaces[key] ? allSpaces.get(spaces[key].spaceId) : undefined)
  const bySpaceId = new Map(Object.values(spaces).map((space) => [space.spaceId, liveSpace(space.key)]))
  const personal = liveSpace("personal")
  const resources = (options.resources ?? []).map((resource) => ({ ...resource }))
  const grants = (options.grants ?? []).map((grant) => ({ ...grant }))
  const controlLog = []
  let serial = 0
  const nextId = (prefix) => `${prefix}_eval_${(serial += 1)}`
  const roleOf = (userId, space) => CONTROL_USERS[userId]?.spaces?.[space.key] ?? ""

  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1")
    requests.push(`${request.method} ${url.pathname}`)

    if (url.pathname === "/health") {
      jsonResponse(response, 200, { status: "ok" })
      return
    }
    if (request.headers.authorization !== `Bearer ${token}`) {
      jsonResponse(response, 401, { error: "unauthorized" })
      return
    }

    try {
      // The real gateway resolves the selected/bound space and derives records
      // headers; the plugin sends its public space and session, not those
      // internal headers. Never forward the caller's claimed role or team.
      if (options.recordsURL && request.method === "POST" && /^\/records\/v1\/[a-z]+\.[a-z][A-Za-z]*$/.test(url.pathname)) {
        const requested = String(request.headers["x-mem-space-id"] ?? "")
        const session = String(request.headers["x-tdai-session-id"] ?? "")
        const space = requested ? bySpaceId.get(requested) : spaces[bindings.get(session) ?? defaultKey]
        const role = space && roleOf("eval", space)
        if (!space || !role) {
          jsonResponse(response, 403, { error: { code: "forbidden", message: "space not available" } })
          return
        }
        const body = await readRequestBody(request)
        const upstream = await fetch(`${options.recordsURL}${url.pathname}`, {
          method: "POST",
          headers: recordsHeaders(space, { user: "eval", role, agent: String(request.headers["x-tdai-agent-id"] ?? "build"), session: session || "ses_eval", tz: String(request.headers["x-mem-tz"] ?? "Europe/London") }),
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(10_000),
        })
        response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" })
        response.end(Buffer.from(await upstream.arrayBuffer()))
        return
      }
      if (request.method === "GET" && url.pathname === "/v1/spaces") {
        const userId = url.searchParams.get("user_id")
        if (userId && userId !== "eval") {
          jsonResponse(response, 403, { error: "unknown user" })
          return
        }
        jsonResponse(response, 200, { spaces: Object.values(spaces).map((space) => publicSpace(liveSpace(space.key))) })
        return
      }

      if (request.method === "POST" && url.pathname === "/v1/context") {
        const body = await readRequestBody(request)
        if (body.user_id && body.user_id !== "eval") {
          jsonResponse(response, 403, { error: "unknown user" })
          return
        }
        const requested = body.space_id ? bySpaceId.get(String(body.space_id)) : undefined
        if (body.space_id && !requested) {
          jsonResponse(response, 403, { error: "space not available" })
          return
        }
        const sessionID = body.session_id ? String(body.session_id) : ""
        const key = requested?.key ?? (sessionID ? bindings.get(sessionID) : undefined) ?? defaultKey
        if (!spaces[key]) {
          jsonResponse(response, 403, { error: "space not available" })
          return
        }
        if (sessionID) bindings.set(sessionID, key)
        const space = liveSpace(key)
        jsonResponse(response, 200, {
          user_id: "eval",
          space: { id: space.spaceId, name: space.name, kind: space.kind, role: space.role },
          collection: { id: space.collectionId, name: space.collectionName },
          placement: { container_id: space.containerId, cell_id: "eval-cell", service_id: "eval-service" },
          ...(sessionID ? { session: { space_id: space.spaceId } } : {}),
          personal_space: { id: personal.spaceId, name: personal.name, kind: personal.kind },
        })
        return
      }

      if (request.method === "GET" && url.pathname === "/v1/grants") {
        const spaceId = url.searchParams.get("space_id") ?? ""
        const space = bySpaceId.get(spaceId)
        if (!space) {
          jsonResponse(response, 403, { error: "space not available" })
          return
        }
        const resourceIds = new Set(resources.filter((resource) => resource.space_id === space.spaceId).map((resource) => resource.id))
        jsonResponse(response, 200, {
          grants: [
            {
              id: `grant_eval_${space.key}`,
              target_type: "space",
              target_id: space.spaceId,
              principal_type: "user",
              principal_id: "eval",
              role: space.role,
              inherit: true,
              expires_at: "",
              created_at: "2026-01-01T00:00:00.000Z",
            },
            ...grants.filter((grant) => grant.space_id === space.spaceId || resourceIds.has(grant.target_id)),
          ],
        })
        return
      }

      if (request.method === "POST" && url.pathname === "/v1/grants") {
        const body = await readRequestBody(request)
        controlLog.push({ method: "POST", path: url.pathname, body })
        const target = resources.find((resource) => resource.id === body.target_id) ?? (body.target_type === "space" ? { space_id: body.target_id } : null)
        if (!target) {
          jsonResponse(response, 404, { error: { code: "not_found", message: "Grant target not found" } })
          return
        }
        if (!["user", "group", "org_role", "agent"].includes(String(body.principal_type))) {
          jsonResponse(response, 400, { error: { code: "unsupported_principal_type", message: "use user, group, org_role, or agent" } })
          return
        }
        if (body.principal_type === "user" && !CONTROL_USERS[String(body.principal_id)]) {
          jsonResponse(response, 404, { error: { code: "not_found", message: "Principal user not found" } })
          return
        }
        const space = allSpaces.get(target.space_id)
        if (!space || !["owner", "admin", "editor"].includes(roleOf("eval", space))) {
          jsonResponse(response, 403, { error: { code: "forbidden", message: "Granting needs editor access to the target" } })
          return
        }
        const grant = {
          id: nextId("grant"),
          space_id: target.space_id,
          target_type: String(body.target_type ?? "resource"),
          target_id: String(body.target_id),
          principal_type: String(body.principal_type),
          principal_id: String(body.principal_id),
          role: String(body.role ?? "viewer"),
          expires_at: String(body.expires_at ?? ""),
          created_by: "eval",
          created_at: "2026-11-08T12:00:00.000Z",
        }
        grants.push(grant)
        jsonResponse(response, 201, { grant })
        return
      }

      const grantItem = url.pathname.match(/^\/v1\/grants\/([^/]+)$/)
      if (request.method === "DELETE" && grantItem) {
        controlLog.push({ method: "DELETE", path: url.pathname, body: {} })
        const index = grants.findIndex((grant) => grant.id === decodeURIComponent(grantItem[1]))
        if (index === -1) {
          jsonResponse(response, 404, { error: { code: "not_found", message: "Grant not found" } })
          return
        }
        grants.splice(index, 1)
        response.writeHead(204)
        response.end()
        return
      }

      const resourceList = url.pathname.match(/^\/v1\/spaces\/([^/]+)\/resources$/)
      if (resourceList) {
        const space = allSpaces.get(decodeURIComponent(resourceList[1]))
        if (!space || !roleOf("eval", space)) {
          jsonResponse(response, 403, { error: { code: "forbidden", message: "space not available" } })
          return
        }
        if (request.method === "GET") {
          jsonResponse(response, 200, { resources: resources.filter((resource) => resource.space_id === space.spaceId) })
          return
        }
        if (request.method === "POST") {
          const body = await readRequestBody(request)
          controlLog.push({ method: "POST", path: url.pathname, body })
          if (!["owner", "admin", "editor"].includes(roleOf("eval", space))) {
            jsonResponse(response, 403, { error: { code: "forbidden", message: "Registering a resource needs editor access" } })
            return
          }
          const existing = resources.find((resource) => resource.space_id === space.spaceId && resource.kind === body.kind && resource.upstream_id === body.upstream_id)
          if (existing) {
            jsonResponse(response, 409, { error: { code: "resource_exists", message: "A resource with this upstream_id already exists" } })
            return
          }
          const resource = {
            id: nextId("res"),
            space_id: space.spaceId,
            kind: String(body.kind ?? ""),
            upstream_id: String(body.upstream_id ?? ""),
            name: String(body.name ?? body.upstream_id ?? ""),
            owner_user_id: "eval",
            created_at: "2026-11-08T12:00:00.000Z",
          }
          resources.push(resource)
          jsonResponse(response, 201, { resource })
          return
        }
      }

      // A resource item: delete (revoke a share's catalog row) or an owner
      // change (contract §3 "Transfer"; the route is the PLUG/GW lanes' to
      // name, so PATCH, PUT and POST on the item, `/owner` and `/transfer` are
      // all accepted with `owner_user_id`, `owner` or `to`).
      const resourceItem = url.pathname.match(/^\/v1\/spaces\/([^/]+)\/resources\/([^/]+?)(?:\/(owner|transfer))?$/)
      if (resourceItem) {
        const space = allSpaces.get(decodeURIComponent(resourceItem[1]))
        const resource = resources.find((entry) => entry.id === decodeURIComponent(resourceItem[2]) && entry.space_id === space?.spaceId)
        if (!space || !resource) {
          jsonResponse(response, 404, { error: { code: "not_found", message: "Resource not found" } })
          return
        }
        if (request.method === "DELETE") {
          controlLog.push({ method: "DELETE", path: url.pathname, body: {} })
          resources.splice(resources.indexOf(resource), 1)
          for (let index = grants.length - 1; index >= 0; index -= 1) if (grants[index].target_id === resource.id) grants.splice(index, 1)
          jsonResponse(response, 200, { resource, deleted: true })
          return
        }
        if (["PATCH", "PUT", "POST"].includes(request.method)) {
          const body = await readRequestBody(request)
          controlLog.push({ method: request.method, path: url.pathname, body })
          const owner = String(body.owner_user_id ?? body.owner ?? body.to ?? "")
          if (!CONTROL_USERS[owner]) {
            jsonResponse(response, 404, { error: { code: "not_found", message: "New owner not found" } })
            return
          }
          resource.owner_user_id = owner
          jsonResponse(response, 200, { resource })
          return
        }
      }

      // A person's own space lifecycle (DESIGN-CRUD S2; the real gateway's
      // space-lifecycle-api.mjs). Each commit lands in controlLog with an
      // `endpoint` the write allowlist and the lifecycle suite read; a
      // preview is not a write. A G2 commit needs the `expected_digest` the
      // preview answered (a bearer's), and a handover is only ever a request
      // here: the fake issues no console session for the plugin.
      if (request.method === "POST" && url.pathname === "/v1/spaces") {
        const body = await readRequestBody(request)
        const name = String(body.name ?? "").trim()
        if (!name) {
          jsonResponse(response, 400, { error: "name is required", code: "invalid_request" })
          return
        }
        const id = nextId("spc")
        controlLog.push({ method: "POST", path: url.pathname, body, endpoint: "space.create", name })
        jsonResponse(response, 201, { space: { id, name, kind: "shared", status: "active", role: "owner" }, owned: 1, cap: 20 })
        return
      }
      const lifecycle = url.pathname.match(/^\/v1\/spaces\/([^/]+)(?:\/(preview|leave|handover))?$/)
      if (lifecycle && (request.method === "PATCH" || (request.method === "POST" && lifecycle[2]))) {
        const space = allSpaces.get(decodeURIComponent(lifecycle[1]))
        const role = space ? roleOf("eval", space) : ""
        if (!space || !role || space.kind !== "shared") {
          jsonResponse(response, 404, { error: "the requested object was not found", code: "not_found" })
          return
        }
        const body = await readRequestBody(request)
        // The digest of the state the preview showed: a stable function of it,
        // as control's is of the rows (tests assert the refusal, not the value).
        const digestFor = (state) => createHash("sha256").update(JSON.stringify(state)).digest("base64url")
        const stateFor = (action) => ({ kind: space.kind, name: space.name, status: space.status ?? "active", owner_user_id: "eval", action })
        const refuse = () => jsonResponse(response, 409, { error: "The space changed since the preview, so nothing changed. Show the person the new preview.", code: "state_changed" })
        // The gateway's agent-facing refusal for a role control does not grant (see the preview).
        const insufficientRole = () => jsonResponse(response, 403, { error: "your role in this space does not allow this", code: "insufficient_role" })
        const digestRequired = () => jsonResponse(response, 400, { error: "expected_digest is required: POST /v1/spaces/<id>/preview \"action\" answers it, and the commit sends it back", code: "digest_required" })
        if (lifecycle[2] === "preview") {
          const action = String(body.action ?? "")
          // Production refuses an archive or handover preview from anyone but
          // the owner before it answers anything: control's `membership(...,
          // "owner")` (control/src/service/space-manage.js:361 archive, :382
          // handover). The plugin reaches control through the gateway, which
          // never forwards control's body: deploy/auth/space-lifecycle-api.mjs
          // `sendError` maps it with `publicControlError`
          // (deploy/auth/control/errors.mjs), so the caller sees 403
          // {error: "your role in this space does not allow this", code: "insufficient_role"}.
          if ((action === "handover" || action === "archive") && role !== "owner") return insufficientRole()
          const user = body.user_id ? String(body.user_id) : ""
          const member = user ? Object.entries(CONTROL_USERS).find(([userId, entry]) => userId.toLowerCase() === user.toLowerCase() && entry.spaces[space.key]) : null
          if (action === "handover" && !member) {
            jsonResponse(response, 400, { error: "the new owner must already be a member of the space; invite them first", code: "not_a_member" })
            return
          }
          const summary =
            action === "archive"
              ? `${space.name} goes offline for every member: nothing in it can be read or written until its owner unarchives it. Nothing is deleted.`
              : action === "leave"
                ? `You lose access to ${space.name} (role ${role}); only an admin can add you back.`
                : `${member?.[1].name ?? user} becomes the owner of ${space.name}; you become an admin and cannot take ownership back yourself.`
          jsonResponse(response, 200, { action, space: { id: space.spaceId, name: space.name }, effect: { summary, reversible: action === "archive", ...(member ? { new_owner: { user_id: member[0], name: member[1].name } } : {}) }, state: stateFor(action), expected_digest: digestFor(stateFor(action)) })
          return
        }
        if (lifecycle[2] === "leave") {
          if (!body.expected_digest) return digestRequired()
          if (body.expected_digest !== digestFor(stateFor("leave"))) return refuse()
          controlLog.push({ method: "POST", path: url.pathname, body: {}, endpoint: "space.leave" })
          jsonResponse(response, 200, { left: true, space: { id: space.spaceId, name: space.name } })
          return
        }
        if (lifecycle[2] === "handover") {
          // control/src/service/space-manage.js:428: the owner role, before the digest.
          if (role !== "owner") return insufficientRole()
          if (!body.expected_digest) return digestRequired()
          if (body.expected_digest !== digestFor(stateFor("handover"))) return refuse()
          // A bearer files the request; the owner confirms it in the console.
          controlLog.push({ method: "POST", path: url.pathname, body: { user_id: body.user_id }, endpoint: "space.handover_requested", user_id: String(body.user_id ?? "") })
          jsonResponse(response, 202, { requested: true, space: { id: space.spaceId, name: space.name }, owner_user_id: String(body.user_id ?? ""), next: "the owner confirms it in Memory's console" })
          return
        }
        if (body.name !== undefined) {
          // control/src/service/space-manage.js:238 (`updateName`): the admin
          // role, and a 409 when the space is archived (:237). The gateway's
          // body is the caller's, not control's (deploy/auth/control/errors.mjs).
          if (role !== "owner" && role !== "admin") return insufficientRole()
          // Store it, as the real control's `updateName` does: every later read
          // (the list, and this session's context) returns the new name.
          const from = space.name
          space.name = String(body.name)
          controlLog.push({ method: "PATCH", path: url.pathname, body: { name: body.name }, endpoint: "space.rename", name: space.name })
          jsonResponse(response, 200, { space: { id: space.spaceId, name: space.name, kind: "shared", status: "active" }, from })
          return
        }
        if (body.status === "active") {
          controlLog.push({ method: "PATCH", path: url.pathname, body: { status: "active" }, endpoint: "space.unarchive" })
          jsonResponse(response, 200, { space: { id: space.spaceId, name: space.name, kind: "shared", status: "active" }, unchanged: true })
          return
        }
        if (body.status === "archived") {
          // control/src/service/space-manage.js:259 (`changeStatus`): the owner
          // role, checked before the digest is required (:275).
          if (role !== "owner") return insufficientRole()
          if (!body.expected_digest) return digestRequired()
          if (body.expected_digest !== digestFor(stateFor("archive"))) return refuse()
          controlLog.push({ method: "PATCH", path: url.pathname, body: { status: "archived" }, endpoint: "space.archive" })
          jsonResponse(response, 200, { space: { id: space.spaceId, name: space.name, kind: "shared", status: "archived" } })
          return
        }
        jsonResponse(response, 400, { error: "send name or status", code: "invalid_request" })
        return
      }

      const members = url.pathname.match(/^\/v1\/spaces\/([^/]+)\/members$/)
      if (request.method === "GET" && members) {
        const space = bySpaceId.get(decodeURIComponent(members[1]))
        if (!space) {
          jsonResponse(response, 403, { error: "space not available" })
          return
        }
        // The 0.9.0 suites read the roster in CONTROL_USERS; every earlier suite
        // keeps the roster it was baselined on.
        jsonResponse(response, 200, {
          members: options.roster === "v1"
            ? Object.entries(CONTROL_USERS)
                .filter(([, user]) => user.spaces[space.key])
                .map(([userId, user]) => ({ user_id: userId, name: user.name, email: `${userId}@example.invalid`, role: user.spaces[space.key] }))
            : [
                { user_id: "eval", name: "Eval User", email: "eval@example.invalid", role: space.role },
                { user_id: "casey", name: "Casey Reviewer", email: "casey@example.invalid", role: "viewer" },
              ],
        })
        return
      }

      jsonResponse(response, 404, { error: "not found" })
    } catch (error) {
      jsonResponse(response, error.status ?? 500, { error: error.message })
    }
  })

  await new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  const port = typeof address === "object" && address ? address.port : 0
  const close = async () => {
    await new Promise((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections?.()
    })
  }
  const untrack = trackCleanup(close)

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    requests,
    bindings,
    /** What a share did, for the scorer: `{ resources, grants, controlLog }`. */
    state() {
      return {
        resources: resources.map((resource) => ({ ...resource, space: allSpaces.get(resource.space_id)?.key ?? "" })),
        grants: grants.map((grant) => {
          const resource = resources.find((entry) => entry.id === grant.target_id)
          return { ...grant, space: allSpaces.get(grant.space_id)?.key ?? "", upstream_id: resource?.upstream_id ?? "", resource_kind: resource?.kind ?? "" }
        }),
        controlLog: controlLog.map((entry) => ({ ...entry })),
      }
    },
    async close() {
      untrack()
      await close()
    },
  }
}

// ---------------------------------------------------------------------------
// Persistent OpenCode server (needed for host compaction)
// ---------------------------------------------------------------------------
