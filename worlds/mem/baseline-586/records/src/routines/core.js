/**
 * The day's turns from the cell's core (memory-v1-contracts.md §5 Inputs).
 *
 * `POST {RECORDS_CORE_URL}/v3/conversation/query` with the space's container as
 * `team_id`, `time_start`/`time_end`, and `limit`/`offset` paging, as the
 * plugin sends it (src/backend/v3.js `queryConversations`), with the headers
 * the gateway forwards to the core (deploy/auth/control/redaction.mjs
 * `scopeHeaders`): `x-tdai-service-id`, `x-tdai-team-id`, `x-tdai-user-id`,
 * `x-tdai-agent-id`, and the cell's core key as the bearer.
 *
 * Strict isolation (`V3_STRICT_ISOLATION`, image `src/gateway/v2-router.ts`
 * `collectV3Missing`) rejects a `/v3` read that lacks `team_id`, `agent_id` or
 * `user_id` (body or the matching `x-tdai-*` header) with 422. There is no
 * cross-agent read: one call is one `(team, user, agent)`. A routine therefore
 * queries each agent it was given, and drops any row outside that triple.
 * The core answers `{code: 0, data: {messages, total}}`, newest first; each row
 * is `{id: "msg-…", role, content, session_id, user_id, agent_id, recorded_at}`.
 */

export class CoreError extends Error {
  constructor(message, status = 0) {
    super(message)
    this.name = "CoreError"
    this.status = status
  }
}

/**
 * @param {{url?: string, key?: string, serviceId?: string, fetchImpl?: typeof fetch, timeoutMs?: number, pageSize?: number, maxPages?: number}} options
 */
export function createCoreReader(options = {}) {
  const url = String(options.url ?? "").replace(/\/+$/, "")
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const timeoutMs = options.timeoutMs ?? 30_000
  const pageSize = Math.max(1, Math.min(options.pageSize ?? 100, 100))
  const maxPages = options.maxPages ?? 50

  /** The headers the gateway sends the core (`scopeHeaders`). */
  function headersFor({ teamId, serviceId, userId, agentId }) {
    const headers = { "content-type": "application/json" }
    const service = serviceId || options.serviceId
    if (service) headers["x-tdai-service-id"] = String(service)
    if (teamId) headers["x-tdai-team-id"] = String(teamId)
    if (userId) headers["x-tdai-user-id"] = String(userId)
    if (agentId) headers["x-tdai-agent-id"] = String(agentId)
    if (options.key) headers.authorization = `Bearer ${options.key}`
    return headers
  }

  async function request(path, body, scope) {
    const headers = headersFor(scope)
    const attempt = async () => {
      let response
      try {
        response = await fetchImpl(`${url}${path}`, {
          method: "POST",
          headers,
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        })
      } catch (error) {
        throw new CoreError(`the core is unreachable: ${error?.message ?? error}`, 0)
      }
      const text = await response.text()
      let json = {}
      if (text) {
        try {
          json = JSON.parse(text)
        } catch {
          throw new CoreError(`the core answered non-JSON (${response.status})`, response.status)
        }
      }
      if (!response.ok || (typeof json.code === "number" && json.code !== 0)) {
        throw new CoreError(`the core answered ${response.status}: ${json.message ?? response.statusText ?? ""}`.trim(), response.status || 500)
      }
      return json.data !== undefined ? json.data : json
    }
    try {
      return await attempt()
    } catch (error) {
      // A read is idempotent: one retry on a 5xx or a network failure.
      if (error instanceof CoreError && (error.status === 0 || error.status >= 500)) return attempt()
      throw error
    }
  }

  /**
   * One `(user, agent)` to query. A personal scope pairs its owner with each
   * agent. A shared scope must already name the user on each pair: a query
   * without `user_id` is a 422, and omitting it would read the whole team.
   */
  function targetsOf(scope, extraAgents = []) {
    const pairs = []
    const seen = new Set()
    const add = (userId, agentId) => {
      if (!agentId) return
      const user = userId || scope.userId || ""
      if (!user) return
      const key = `${user}\0${agentId}`
      if (seen.has(key)) return
      seen.add(key)
      pairs.push({ userId: String(user), agentId: String(agentId) })
    }
    for (const pair of scope.pairs ?? []) add(pair?.userId, pair?.agentId)
    for (const agentId of [...(scope.agents ?? []), ...extraAgents]) add(scope.userId, agentId)
    return pairs
  }

  /**
   * Agents the core has registered on this team or user (`/v2/team/get`,
   * `/v2/user/get`). Gateway capture does not register an agent, so this list
   * misses every agent that exists only as `agent_id` on a turn. A 404 is
   * "none", not a failed run.
   */
  async function listedAgents(scope) {
    const ids = new Set()
    // A listing that failed is not a listing that found none: the caller says
    // which, so an outage never reads as "this space has no turns".
    let failed = false
    const take = async (path, body) => {
      try {
        return await request(path, body, scope)
      } catch {
        failed = true
        return null
      }
    }
    if (scope.teamId) {
      const team = await take("/v2/team/get", { team_id: scope.teamId })
      for (const id of team?.agent_ids ?? []) if (id) ids.add(String(id))
    }
    if (scope.userId) {
      const user = await take("/v2/user/get", { user_id: scope.userId })
      for (const id of user?.owned_agent_ids ?? []) if (id) ids.add(String(id))
    }
    return { ids: [...ids], failed }
  }

  function batchOf(data) {
    return Array.isArray(data) ? data : Array.isArray(data?.messages) ? data.messages : Array.isArray(data?.items) ? data.items : []
  }

  function inScope(row, scope, pair) {
    if (!row?.id) return false
    if (scope.teamId && row.team_id && row.team_id !== scope.teamId) return false
    if (pair.userId && row.user_id && row.user_id !== pair.userId) return false
    if (pair.agentId && row.agent_id && row.agent_id !== pair.agentId) return false
    return true
  }

  async function pagePair(scope, pair, { limit }) {
    const rows = []
    for (let page = 0, offset = 0; page < maxPages; page += 1) {
      const data = await request(
        "/v3/conversation/query",
        {
          team_id: scope.teamId,
          user_id: pair.userId,
          agent_id: pair.agentId,
          time_start: scope.start,
          time_end: scope.end,
          limit,
          offset,
        },
        { ...scope, userId: pair.userId, agentId: pair.agentId },
      )
      const batch = batchOf(data).filter((row) => inScope(row, scope, pair))
      rows.push(...batch)
      offset += batchOf(data).length
      const total = Number(data?.total)
      if (batchOf(data).length < limit || (Number.isFinite(total) && offset >= total)) break
    }
    return rows
  }

  /** Rows as the routine reads them, in the window's order. */
  function shapeTurns(rows, scope) {
    return [...rows.values()]
      .map((row) => ({
        id: String(row.id),
        role: String(row.role ?? "user"),
        content: typeof row.content === "string" ? row.content : JSON.stringify(row.content ?? ""),
        session_id: row.session_id ?? null,
        user_id: row.user_id ?? null,
        agent_id: row.agent_id ?? null,
        at: String(row.recorded_at ?? row.timestamp ?? row.created_at ?? ""),
      }))
      .filter((t) => (!scope.start || !t.at || t.at >= scope.start) && (!scope.end || !t.at || t.at < scope.end))
      .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : a.id < b.id ? -1 : 1))
  }

  async function pairsFor(scope) {
    const given = targetsOf(scope)
    if (given.length > 0) return { pairs: given, failed: false }
    const listed = await listedAgents(scope)
    return { pairs: targetsOf(scope, listed.ids), failed: listed.failed }
  }

  return {
    available: Boolean(url),

    /**
     * Every turn of the space in [start, end), oldest first. One query per
     * `(user, agent)`, each carrying `x-tdai-agent-id` and body `agent_id`.
     * A call with no agent is not sent: strict isolation would 422, and an
     * unscoped read would cross agents. `serviceId` falls back to
     * RECORDS_CORE_SERVICE_ID.
     * @returns {Promise<Array<{id: string, role: string, content: string, session_id: string|null, user_id: string|null, agent_id: string|null, at: string}>>}
     */
    /**
     * The same read as `turns`, saying whether it happened: `{ok: true, turns}`
     * when the core answered, `{ok: false, error}` when it could not be reached,
     * refused a call, or could not even list the space's agents. A caller that
     * asks "does the core still hold this turn" must not read a fault as "no".
     */
    async turnsReport(scope) {
      if (!url) return { ok: false, turns: [], error: "the core is not configured" }
      let pairs
      try {
        const found = await pairsFor(scope)
        // A listing that failed is not an answer, however many pairs were
        // configured: an agent it would have named may hold the turn.
        if (found.failed) return { ok: false, turns: [], error: "the core could not list the space's agents" }
        pairs = found.pairs
      } catch (error) {
        return { ok: false, turns: [], error: String(error?.message ?? error) }
      }
      if (pairs.length === 0) return { ok: true, turns: [] }
      const rows = new Map()
      try {
        for (const pair of pairs) {
          for (const row of await pagePair({ ...scope, start: scope.start, end: scope.end }, pair, { limit: pageSize })) rows.set(String(row.id), row)
        }
      } catch (error) {
        return { ok: false, turns: [], error: String(error?.message ?? error) }
      }
      return { ok: true, turns: shapeTurns(rows, scope) }
    },

    /**
     * Every turn of the space in [start, end), oldest first. One query per
     * `(user, agent)`, each carrying `x-tdai-agent-id` and body `agent_id`.
     * A call with no agent is not sent: strict isolation would 422, and an
     * unscoped read would cross agents. A failed read throws, as before;
     * `turnsReport` answers a caller that must tell a fault from an empty day.
     * @returns {Promise<Array<{id: string, role: string, content: string, session_id: string|null, user_id: string|null, agent_id: string|null, at: string}>>}
     */
    async turns(scope) {
      if (!url) return []
      const { pairs } = await pairsFor(scope)
      if (pairs.length === 0) return []
      const rows = new Map()
      for (const pair of pairs) {
        for (const row of await pagePair({ ...scope, start: scope.start, end: scope.end }, pair, { limit: pageSize })) rows.set(String(row.id), row)
      }
      return shapeTurns(rows, scope)
    },

    /** True when any of the space's agents has a turn in [start, end). */
    async any(scope) {
      if (!url) return false
      const { pairs } = await pairsFor(scope)
      for (const pair of pairs) {
        const data = await request(
          "/v3/conversation/query",
          { team_id: scope.teamId, user_id: pair.userId, agent_id: pair.agentId, time_start: scope.start, time_end: scope.end, limit: 1, offset: 0 },
          { ...scope, userId: pair.userId, agentId: pair.agentId },
        )
        if (batchOf(data).some((row) => inScope(row, scope, pair))) return true
      }
      return false
    },
  }
}
