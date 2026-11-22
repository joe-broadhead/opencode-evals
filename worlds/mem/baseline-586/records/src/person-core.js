/**
 * The core and hub half of a person-level erasure: their captured turns (L0),
 * the atoms extracted from them (L1), every scenario (L2) and persona (L3)
 * their container holds for them, and the skills, wikis and code graphs of
 * their personal space.
 *
 * The core's delete contract is upstream `rowMatchesIsolation`
 * (stub/server.js): a delete removes a row only when team, user and agent equal
 * the requested isolation, and for L0 the session too. A row is therefore read
 * first and deleted under its own isolation, as `scripts/prune.mjs`
 * `groupForDelete` and `space-purge.mjs` do — and `/v3` reads carry the team
 * and user, which strict isolation requires.
 *
 * L2 and L3 are keyed by `(team, agent)`, so they are erased for **every**
 * agent the container holds for the person: the agents their rows name, the
 * agents the cell lists, and `build`. A new person has no `personal_agent`, and
 * their memory still spans `general`, `build`, `explore` and others.
 *
 * Nothing here reports success it did not check: every layer is read back and
 * the answer carries what remains, so control never calls an erasure done on
 * an unverified purge.
 *
 * The person's own `memory_audit` and `entity_knowledge` rows are not a layer
 * of `/v3`: the core's operator route deletes them (`POST /v3/ops/erase/user`,
 * `createPersonRowsEraser` below). It is its own step, called after this purge,
 * so a slow or failing core never holds the rest of an erasure.
 */

/**
 * The core's contract, as the repository records it, for every call this purge
 * makes:
 *
 * - **Isolation.** `/v3` is `team_id + agent_id + user_id`; a read or delete
 *   without one of the three is `422` (`docs/research/tencent.md:34`,
 *   `records/src/routines/core.js:11-15`). L0 deletes also need the row's
 *   `session_id`; L1 deletes team, user and agent (`stub/server.js`
 *   `rowMatchesIsolation`).
 * - **Agents.** The list is `/v2/team/get` `agent_ids`, `/v2/user/get`
 *   `owned_agent_ids`, `/v3/meta/agent/list`, and the base names the gateway
 *   knows (`records/src/routines/core.js:115-165`). A read is sent per agent.
 * - **Paging.** `{limit, offset}`; a batch shorter than `limit` is the end.
 * - **Errors.** A non-2xx or `code != 0` is an error; `404` on an asset is
 *   "absent", not a failure.
 * - **Deletes** report `deleted_count`; a missing count proves nothing, so
 *   every layer is read back.
 */

const PAGE = 100
/** One run drains this many pages before failing; the retry continues. */
const MAX_ROUNDS = 2_000
const DELETE_CHUNK = 100
/** The operator route for a person's own audit and knowledge rows. */
const OPS_ERASE_USER = "/v3/ops/erase/user"
/** The agents a container always has, as `space-purge.mjs` assumes. */
const BASE_AGENTS = Object.freeze(["build", "general", "explore", "plan", "agent"])
const ASSET_KINDS = Object.freeze({
  skill: { get: "/v3/skill/get", del: "/v3/skill/delete", field: "skill_id" },
  wiki: { get: "/v3/wiki/get", del: "/v3/wiki/delete", field: "wiki_id", listField: "wiki_ids" },
  code_graph: {
    get: "/v3/code-graph/get",
    del: "/v3/code-graph/delete",
    field: "code_graph_id",
    listField: "code_graph_ids",
  },
})

export class CoreEraseError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = "CoreEraseError"
    this.status = status
  }
}

function itemsOf(payload, key) {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== "object") return []
  if (key && Array.isArray(payload[key])) return payload[key]
  if (Array.isArray(payload.items)) return payload.items
  if (Array.isArray(payload.messages)) return payload.messages
  return []
}

/** The isolation a delete must repeat: the row's own user, agent and session. */
function isolationOf(row, { bySession }) {
  const isolation = {}
  if (row.user_id) isolation.user_id = String(row.user_id)
  if (row.agent_id) isolation.agent_id = String(row.agent_id)
  if (bySession && row.session_id) isolation.session_id = String(row.session_id)
  return isolation
}

function groupRows(rows, { bySession }) {
  const groups = new Map()
  for (const row of rows) {
    const isolation = isolationOf(row, { bySession })
    const key = `${isolation.user_id ?? ""}\u0000${isolation.agent_id ?? ""}\u0000${isolation.session_id ?? ""}`
    if (!groups.has(key)) groups.set(key, { isolation, ids: [] })
    groups.get(key).ids.push(String(row.id))
  }
  return [...groups.values()]
}

/**
 * @param {{
 *   url?: string, key?: string, knowledgeUrl?: string, knowledgeKey?: string,
 *   serviceId?: string, fetchImpl?: typeof fetch, timeoutMs?: number
 * }} options
 */
export function createPersonCoreEraser(options = {}) {
  const url = String(options.url ?? "").replace(/\/+$/, "")
  const knowledgeUrl = String(options.knowledgeUrl ?? options.url ?? "").replace(/\/+$/, "")
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!url) return null

  /** Headers and body fields the core reads as the scope (body wins). */
  function scopeOf({ container, userId, agent, session }) {
    const headers = { "content-type": "application/json" }
    const body = {}
    if (options.serviceId) headers["x-tdai-service-id"] = String(options.serviceId)
    if (container) {
      headers["x-tdai-team-id"] = String(container)
      body.team_id = String(container)
    }
    if (userId) {
      headers["x-tdai-user-id"] = String(userId)
      body.user_id = String(userId)
    }
    if (agent) {
      headers["x-tdai-agent-id"] = String(agent)
      body.agent_id = String(agent)
    }
    if (session) {
      headers["x-tdai-session-id"] = String(session)
      body.session_id = String(session)
    }
    return { headers, body }
  }

  async function post(base, path, body, scope, key) {
    const bearer = key ?? options.key
    let response
    try {
      response = await fetchImpl(`${base}${path}`, {
        method: "POST",
        headers: {
          ...scope.headers,
          ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
        },
        body: JSON.stringify({ ...scope.body, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      throw new CoreEraseError(`the core is unreachable at ${path}`, 0)
    }
    const text = await response.text()
    let json = {}
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        throw new CoreEraseError(`the core answered non-JSON at ${path}`, response.status)
      }
    }
    if (!response.ok || (typeof json.code === "number" && json.code !== 0)) {
      throw new CoreEraseError(`the core answered ${response.status} at ${path}`, response.status || 500)
    }
    return json.data !== undefined ? json.data : json
  }

  /**
   * One layer: read a page under the person's scope, delete each row under its
   * own isolation, and read again until it is empty.
   */
  async function drain({ container, userId, agent, query, listKey, del, delField, bySession }) {
    let deleted = 0
    const agents = new Set([agent])
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      // The read carries the agent: `/v3` is team + agent + user, or 422.
      const scope = scopeOf({ container, userId, agent })
      const data = await post(url, query, { limit: PAGE, offset: 0 }, scope)
      const rows = itemsOf(data, listKey).filter((row) => row?.id !== undefined)
      if (rows.length === 0) return { deleted, remaining: 0, agents: [...agents] }
      for (const row of rows) if (row.agent_id) agents.add(String(row.agent_id))
      for (const group of groupRows(rows, { bySession })) {
        for (let index = 0; index < group.ids.length; index += DELETE_CHUNK) {
          const chunk = group.ids.slice(index, index + DELETE_CHUNK)
          const isolation = group.isolation
          const deleteScope = scopeOf({
            container,
            userId: isolation.user_id,
            agent: isolation.agent_id,
            session: isolation.session_id,
          })
          const result = await post(url, del, { [delField]: chunk }, deleteScope)
          // A delete that reports no count is not counted as deleted; the next
          // read is what proves it went.
          const count = Number(result?.deleted_count)
          if (Number.isFinite(count)) deleted += count
        }
      }
    }
    throw new CoreEraseError(`${query}: more rows than one erasure run may drain`, 0)
  }

  /** One final read of a layer: rows still there after the deletes. */
  async function remainingRows({ container, userId, agent, query, listKey }) {
    const data = await post(url, query, { limit: 1, offset: 0 }, scopeOf({ container, userId, agent }))
    return itemsOf(data, listKey).length
  }

  /**
   * Every agent this container holds for the person, as the routines discover
   * them: the cell's registration (`/v2/team/get`, `/v2/user/get`), the meta
   * list, and the base names. A read is never sent without one of these.
   */
  async function agentsOf({ container, userId, fromRows }) {
    const agents = new Set([...BASE_AGENTS, ...fromRows])
    const take = async (path, body, field) => {
      try {
        const answer = await post(url, path, body, scopeOf({ container, userId }))
        for (const name of answer?.[field] ?? []) if (name) agents.add(String(name))
      } catch {
        // As the routines client does (`routines/core.js:117-123`), a
        // registration error is tolerated: the agents the rows and the meta
        // list name still cover the purge. A hard failure here would fail
        // every erasure for a cell whose `/v2` refuses the cell key.
      }
    }
    await take("/v2/team/get", { team_id: container }, "agent_ids")
    await take("/v2/user/get", { user_id: userId }, "owned_agent_ids")
    try {
      const listed = await post(url, "/v3/meta/agent/list", { limit: 100, offset: 0, agent_id: "agent" }, scopeOf({ container, userId, agent: "agent" }))
      for (const item of itemsOf(listed, "items")) {
        const name = item?.name ?? item?.agent_id
        if (name) agents.add(String(name))
      }
    } catch (error) {
      if (error.status !== 404) throw error
    }
    return [...agents]
  }

  /** L2 (scenario files) and L3 (persona) for one agent, read back after. */
  async function eraseCurated({ container, userId, agent }) {
    const scope = scopeOf({ container, userId, agent })
    let scenarios = 0
    const listed = await post(url, "/v3/scenario/ls", { path_prefix: "" }, scope)
    for (const entry of listed?.entries ?? []) {
      const file = String(entry?.path ?? "")
      if (!file || file.endsWith("/")) continue
      try {
        await post(url, "/v3/scenario/rm", { path: file }, scope)
        scenarios += 1
      } catch (error) {
        if (error.status !== 404) throw error
      }
    }
    let persona = 0
    const read = await post(url, "/v3/core/read", {}, scope)
    if (read?.content) {
      await post(url, "/v3/core/write", { content: "" }, scope)
      persona = 1
    }
    // Read back: any file left, or a persona still there, is reported.
    let remaining = 0
    const reread = await post(url, "/v3/scenario/ls", { path_prefix: "" }, scope)
    remaining += (reread?.entries ?? []).filter((entry) => {
      const file = String(entry?.path ?? "")
      return file && !file.endsWith("/")
    }).length
    const after = await post(url, "/v3/core/read", {}, scope)
    if (after?.content) remaining += 1
    return { scenarios, persona, remaining }
  }

  function knowledgeScope({ container, userId, agent }) {
    const scope = scopeOf({ container, userId, agent })
    return { headers: scope.headers, body: {} }
  }

  /** The personal space's own assets, by the ids control registered. */
  async function eraseAssets({ container, userId, agent, assets }) {
    const counts = { skills: 0, wikis: 0, code_graphs: 0, remaining: 0 }
    if (!Array.isArray(assets) || assets.length === 0) return counts
    const scope = knowledgeScope({ container, userId, agent })
    const key = options.knowledgeKey ?? options.key
    const base = knowledgeUrl
    const still = []
    for (const asset of assets) {
      const kind = ASSET_KINDS[asset?.kind]
      if (!kind || typeof asset.id !== "string" || !asset.id) continue
      if (asset.kind === "skill") {
        let version = asset.version
        if (!Number.isInteger(version)) {
          try {
            const found = await post(base, kind.get, { skill_id: asset.id }, scope, key)
            version = Number(found?.version)
          } catch (error) {
            if (error.status === 404) continue
            throw error
          }
        }
        if (Number.isInteger(version) && version >= 1) {
          try {
            await post(base, kind.del, { skill_id: asset.id, expected_version: version }, scope, key)
            counts.skills += 1
          } catch (error) {
            if (error.status !== 404) throw error
          }
        }
        if (!(await absent(base, kind.get, "skill_id", asset.id, scope, key))) still.push(asset)
        continue
      }
      try {
        const result = await post(base, kind.del, { [kind.listField]: [asset.id] }, scope, key)
        const deletedIds = (result?.deleted_ids ?? []).map(String)
        const failure = (result?.failed ?? []).find((entry) => String(entry?.id) === String(asset.id))
        if (deletedIds.includes(String(asset.id))) {
          counts[asset.kind === "wiki" ? "wikis" : "code_graphs"] += 1
        } else if (!failure || !/not found/i.test(String(failure.reason ?? ""))) {
          if (!(await absent(base, kind.get, kind.field, asset.id, scope, key))) still.push(asset)
          continue
        }
      } catch (error) {
        if (error.status !== 404) throw error
      }
      if (!(await absent(base, kind.get, kind.field, asset.id, scope, key))) still.push(asset)
    }
    counts.remaining = still.length
    return counts
  }

  async function absent(base, path, field, id, scope, key) {
    try {
      const found = await post(base, path, { [field]: id }, scope, key)
      return !found || Object.keys(found).length === 0 || (!found[field] && !found.id)
    } catch (error) {
      if (error.status === 404) return true
      throw error
    }
  }

  /**
   * @param {{
   *   container: string, userId: string, agent?: string|null,
   *   assets?: Array<{kind: string, id: string, version?: number}>,
   *   exclusive?: boolean
   * }} input
   */
  return async function erasePersonCore({ container, userId, agent = null, assets = [], exclusive = true }) {
    if (typeof userId !== "string" || !userId) throw new CoreEraseError("a core user id is required")
    if (typeof container !== "string" || !container) throw new CoreEraseError("a container is required")
    // Every agent first, so every read can carry one: a read without an agent
    // is a 422, and rows under an agent the purge does not know are missed.
    const curatedAgents = exclusive
      ? await agentsOf({ container, userId, fromRows: [] })
      : agent
        ? [agent]
        : [...BASE_AGENTS]
    const l0 = { deleted: 0, remaining: 0 }
    const l1 = { deleted: 0, remaining: 0 }
    for (const readAgent of curatedAgents) {
      const done = await drain({
        container,
        userId,
        agent: readAgent,
        query: "/v3/conversation/query",
        listKey: "messages",
        del: "/v3/conversation/delete",
        delField: "message_ids",
        bySession: true,
      })
      l0.deleted += done.deleted
      for (const found of done.agents) if (!curatedAgents.includes(found)) curatedAgents.push(found)
      const atomsDone = await drain({
        container,
        userId,
        agent: readAgent,
        query: "/v3/atomic/query",
        listKey: "items",
        del: "/v3/atomic/delete",
        delField: "ids",
        bySession: false,
      })
      l1.deleted += atomsDone.deleted
      for (const found of atomsDone.agents) if (!curatedAgents.includes(found)) curatedAgents.push(found)
    }
    const curated = []
    for (const curatedAgent of curatedAgents) {
      const done = await eraseCurated({ container, userId, agent: curatedAgent })
      curated.push({ agent: curatedAgent, ...done })
    }
    // A personal space in a container another personal space also uses does not
    // own the hub's assets; control says so and they are left alone.
    const hub = exclusive
      ? await eraseAssets({ container, userId, agent: agent ?? curatedAgents[0] ?? null, assets })
      : { skills: 0, wikis: 0, code_graphs: 0, remaining: 0, skipped: "shared_container" }
    let l0Remaining = 0
    let l1Remaining = 0
    for (const readAgent of curatedAgents) {
      l0Remaining += await remainingRows({ container, userId, agent: readAgent, query: "/v3/conversation/query", listKey: "messages" })
      l1Remaining += await remainingRows({ container, userId, agent: readAgent, query: "/v3/atomic/query", listKey: "items" })
    }
    const curatedRemaining = curated.reduce((total, one) => total + one.remaining, 0)
    return {
      configured: true,
      container,
      l0: { deleted: l0.deleted, remaining: l0Remaining },
      l1: { deleted: l1.deleted, remaining: l1Remaining },
      l2_l3: { agents: curated, remaining: curatedRemaining },
      hub,
      remaining: l0Remaining + l1Remaining + curatedRemaining + (hub.remaining ?? 0),
    }
  }
}

/**
 * The person's `memory_audit` and `entity_knowledge` rows, through the core's
 * operator route: `{user_id, upstream_user_id, dry_run: false}`. `user_id` is
 * the id the gateway sends as `x-tdai-user-id` — control's `upstream_user_id`,
 * the identity's subject, which is the id the core stores — and
 * `upstream_user_id` echoes it for the core's audit trail, never matching a
 * column. Control's own `users.id` is never sent: the core holds no row under
 * it (production, 2026-11-18: every `memory_audit` user id is an upstream id).
 *
 * The instance header and the core's key are the ones every other call here
 * carries. It is its own step, so control can run it after the purge and retry
 * it on its own clock.
 *
 * A failure is answered, not thrown, so control records it in the erasure's
 * report and retries. A 404 is an older core without the route: it is reported
 * as not supported, never as done.
 *
 * @param {{ url?: string, key?: string, serviceId?: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export function createPersonRowsEraser(options = {}) {
  const url = String(options.url ?? "").replace(/\/+$/, "")
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  if (!url) return null

  return async function erasePersonRows({ upstreamUserId }) {
    const userId = typeof upstreamUserId === "string" ? upstreamUserId : ""
    if (!userId) return { ok: false, supported: true, status: 0, error: "an upstream user id is required" }
    const headers = { "content-type": "application/json" }
    if (options.serviceId) headers["x-tdai-service-id"] = String(options.serviceId)
    if (options.key) headers.authorization = `Bearer ${options.key}`
    let response
    try {
      response = await fetchImpl(`${url}${OPS_ERASE_USER}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ user_id: userId, upstream_user_id: userId, dry_run: false }),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      return { ok: false, supported: true, status: 0, error: `the core is unreachable at ${OPS_ERASE_USER}` }
    }
    if (response.status === 404) {
      return { ok: false, supported: false, status: 404, reason: "not supported by this core" }
    }
    const text = await response.text()
    let json = {}
    if (text) {
      try {
        json = JSON.parse(text)
      } catch {
        return { ok: false, supported: true, status: response.status, error: `the core answered non-JSON at ${OPS_ERASE_USER}` }
      }
    }
    if (!response.ok || (typeof json.code === "number" && json.code !== 0)) {
      return {
        ok: false,
        supported: true,
        status: response.status || 500,
        error: `the core answered ${response.status} at ${OPS_ERASE_USER}`,
      }
    }
    const data = json.data !== undefined ? json.data : json
    return {
      ok: true,
      supported: true,
      dry_run: data?.dry_run === true,
      rows: Number(data?.rows ?? 0),
      databases: Array.isArray(data?.databases) ? data.databases : [],
      ...(data?.upstream_user === undefined ? {} : { upstream_user: String(data.upstream_user) }),
      // The core's warning code says a zero is not "nothing of theirs": a core
      // with no metadata user for this person answers `no_metadata_user`
      // beside it. Allow-listed, and control words it; the code itself is kept
      // on the step, never spoken as the core's own text.
      ...(data?.warning === undefined ? {} : { warning: String(data.warning) }),
    }
  }
}

