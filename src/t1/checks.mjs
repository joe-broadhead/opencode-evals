// The T1 checks: what a plugin makes possible, with no model. Each returns one result with evidence, and
// a check that cannot be decided says so (`unsupported`) rather than passing.

import { call, unwrap } from "./http.mjs"

const norm = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_")

/** The host's own last-match rule evaluation over an agent's resolved permission list. */
export function effectOf(rules, action, resource = "*") {
  let effect = "ask"
  for (const rule of rules ?? []) {
    if (!matches(rule.action, action)) continue
    if (!matches(rule.resource, resource)) continue
    effect = rule.effect
  }
  return effect
}

const matches = (pattern, value) => {
  if (pattern === "*" || pattern === value) return true
  if (pattern.includes("*")) return new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`).test(value)
  return false
}

export async function agents(host) {
  const response = await call(`${host.url}/api/agent`, { headers: { "x-opencode-directory": host.project } })
  return unwrap(response) ?? []
}

export async function describe(host, rpcId, sessionID) {
  const body = { input: sessionID ? { sessionID } : {} }
  const response = await call(`${host.url}/api/rpc/${rpcId}/describe`, { method: "POST", body, headers: { "x-opencode-directory": host.project } })
  if (!response.ok) return { ok: false, status: response.status, json: response.json }
  return { ok: true, describe: response.json?.output ?? response.json }
}

/**
 * The family's rule invariant: a plugin inserts one block of default rules after each agent's own base
 * allow, so an agent is either fully guarded (every declared tool resolves to its declared effect) or
 * untouched. A half-inserted block is the failure this check exists for.
 */
export async function checkRules(host, pack) {
  const list = await agents(host)
  const guarded = []
  const unguarded = []
  const partial = []
  for (const agent of list) {
    const mismatches = []
    for (const tool of pack.tools) {
      const action = tool.permission ?? `x_${tool.name}`
      const declared = tool.effect ?? "allow"
      const resolved = effectOf(agent.permissions, action)
      if (resolved !== declared) mismatches.push(`${action} declared ${declared} resolved ${resolved}`)
    }
    if (mismatches.length === 0) guarded.push(agent.id)
    else if (mismatches.length === pack.tools.length) unguarded.push(agent.id)
    else partial.push({ agent: agent.id, mismatches: mismatches.length, first: mismatches.slice(0, 2) })
  }
  const state = partial.length || guarded.length === 0 ? "fail" : "pass"
  return {
    id: `${pack.id}-rules`,
    kind: "rules",
    state,
    detail:
      state === "fail"
        ? partial.length
          ? `half-inserted block on ${partial.map((p) => `${p.agent} (${p.mismatches}/${pack.tools.length})`).join(", ")}; first: ${partial[0].first.join("; ")}`
          : "no agent is guarded by this plugin's rules"
        : `${guarded.length} agent(s) fully guarded, ${unguarded.length} untouched, over ${pack.tools.length} declared tools`,
    evidence: { guarded, unguarded, partial: partial.map((p) => p.agent) },
  }
}

/**
 * The tools RPC's describe, with a session: the method list, each method's class, and — where the plugin
 * is v2 — the permission the host would apply. A method that would run on `allow` must be a read; a write
 * or a denied tool must resolve to ask or deny.
 */
export async function checkDescribe(host, pack) {
  const session = await createSession(host)
  const result = await describe(host, pack.rpc, session)
  if (!result.ok) {
    // A plugin with no sign-in or no options may not register its RPC at all; that is a state, not a defect.
    const why = String(result.json?.message ?? result.text ?? "").slice(0, 120)
    const missing = result.status === 400 || result.status === 404
    return {
      id: `${pack.id}-describe`,
      kind: "describe",
      state: missing ? "unsupported" : "fail",
      detail: `describe answered ${result.status}${why ? `: ${why}` : ""}`,
      evidence: { session, status: result.status },
    }
  }
  const methods = result.describe?.methods ?? []
  const declared = new Map(pack.tools.map((t) => [t.name, t]))
  const problems = []
  const v2 = methods.some((m) => typeof m.permission === "string")
  if (!methods.length) problems.push("no methods")
  for (const method of methods) {
    const tool = declared.get(method.name)
    if (!tool) {
      problems.push(`${method.name} is not a known tool`)
      continue
    }
    if (v2 && method.permission === "allow" && tool.class !== "read") problems.push(`${method.name} (${tool.class}) would run on allow`)
    if (v2 && tool.effect === "deny" && method.permission === "allow") problems.push(`${method.name} is denied but resolves allow`)
  }
  return {
    id: `${pack.id}-describe`,
    kind: "describe",
    state: problems.length ? "fail" : "pass",
    detail: `${methods.length} methods, ${v2 ? "session permissions present" : "no session permissions (v1)"}, unclassified ${(result.describe?.unclassified ?? []).length}${problems.length ? ` — ${problems.slice(0, 3).join("; ")}` : ""}`,
    evidence: { methods: methods.length, v2, unclassified: result.describe?.unclassified ?? [] },
  }
}

/** A session for the describe check: no model, no prompt, just the agent whose rules are resolved. */
export async function createSession(host, agent = "build") {
  const response = await call(`${host.url}/api/session`, { method: "POST", body: { agent }, headers: { "x-opencode-directory": host.project } })
  return unwrap(response)?.id ?? response.json?.id ?? null
}

/** The status RPC's shared fields, when the pack names one. */
export async function checkStatus(host, pack) {
  if (!pack.statusRpc) return { id: `${pack.id}-status`, kind: "status", state: "unsupported", detail: "no status RPC declared", evidence: {} }
  const response = await call(`${host.url}/api/rpc/${pack.statusRpc}/status`, { method: "POST", body: { input: {} } })
  const data = response.ok ? response.json?.output ?? response.json : null
  const missing = ["version", "host", "state", "unguardedAgents", "nextStep"].filter((key) => !(key in (data ?? {})))
  return {
    id: `${pack.id}-status`,
    kind: "status",
    state: response.ok && !missing.length ? "pass" : "fail",
    detail: response.ok ? (missing.length ? `missing ${missing.join(", ")}` : "all shared fields present") : `status answered ${response.status}`,
    evidence: { missing },
  }
}

/** The capture plugin's record, as events. */
export const captureOf = (lines, kind) => lines.filter((event) => event.kind === kind)

/**
 * A scripted turn that calls one tool, and what the host did with the permission:
 *   asked    the action resolved to ask, the call was declined, and the tool never ran;
 *   refused  the action resolved to deny (or the tool is not offered), and nothing ran;
 *   capped   the arguments reached the MCP boundary after the plugin's shaper, and the result carried
 *            the plugin's appended line.
 */
export function checkScriptedTurn({ pack, caseDef, result, capture, fakeCalls }) {
  const id = `${pack.id}-${caseDef.kind}-${caseDef.tool}`
  const before = captureOf(capture, "execute_before").filter((event) => norm(event.tool).endsWith(norm(caseDef.tool)))
  const after = captureOf(capture, "execute_after").filter((event) => norm(event.tool).endsWith(norm(caseDef.tool)))
  const permissions = captureOf(capture, "permission").filter((event) => norm(event.action) === norm(caseDef.action ?? caseDef.tool) || norm(event.action).endsWith(norm(caseDef.tool)))
  const calls = (fakeCalls ?? []).filter((name) => norm(name).endsWith(norm(caseDef.tool)))
  const text = result.lines.map((line) => { try { return JSON.parse(line).part?.text ?? "" } catch { return "" } }).join(" ")

  if (caseDef.kind === "asked") {
    const asked = permissions.some((event) => event.effect_in === "ask")
    const declinedOnly = after.every((event) => event.status !== "completed")
    const ok = asked && calls.length === 0 && declinedOnly
    return {
      id, kind: "asked", state: ok ? "pass" : "fail",
      detail: `permission ${asked ? "asked" : "not asked"}; ${calls.length} fake call(s); ${after.length} boundary event(s)`,
      evidence: { asked, calls: calls.length, effects: permissions.map((p) => p.effect_in), answerAsked: /approve|declin|permission/i.test(text) },
    }
  }
  if (caseDef.kind === "refused") {
    const resolved = permissions.map((event) => event.effect_in)
    const ok = calls.length === 0 && after.every((event) => event.status !== "completed")
    return {
      id, kind: "refused", state: ok ? "pass" : "fail",
      detail: `${calls.length} fake call(s), ${after.length} boundary event(s), effects ${resolved.join(",") || "none"}`,
      evidence: { calls: calls.length, effects: resolved },
    }
  }
  if (caseDef.kind === "capped") {
    const sent = before[0]?.args ?? {}
    const appended = /Cost:/.test(JSON.stringify(after.map((event) => event.result_keys ?? []))) || after.some((event) => event.result_bytes > 0)
    const capped = caseDef.max !== undefined ? Number(sent.max_results) === caseDef.max : true
    const serverSaw = (fakeCalls ?? []).length > 0
    return {
      id, kind: "capped", state: capped && serverSaw && appended ? "pass" : "fail",
      detail: `max_results at the boundary ${JSON.stringify(sent.max_results)}; server saw ${serverSaw ? "the call" : "nothing"}`,
      evidence: { sent, calls: (fakeCalls ?? []).length },
    }
  }
  return { id, kind: caseDef.kind, state: "unsupported", detail: "unknown case kind", evidence: {} }
}

/**
 * A tool call through the tools RPC: the no-model path that runs the plugin's own shapers. The arguments
 * the MCP server receives are the plugin's, and the result carries what `shapeResult` appended.
 */
export async function checkRpcCall({ host, pack, caseDef, fakeCalls }) {
  const id = `${pack.id}-capped-${caseDef.tool}`
  const session = await createSession(host)
  // The MCP server connects after the plugin loads; a call made during that window answers CONNECTING.
  let response
  for (let attempt = 0; attempt < 30; attempt++) {
    response = await call(`${host.url}/api/rpc/${pack.rpc}/${caseDef.tool}`, {
      method: "POST",
      body: { input: { sessionID: session, input: caseDef.args ?? {} } },
      // The call must reach the location where the plugin is loaded, or the host answers rpc.unavailable.
      headers: { "x-opencode-directory": host.project },
      timeoutMs: 30000,
    })
    if (!/CONNECTING|CONNECTION_FAILED/.test(String(response.text ?? ""))) break
    await new Promise((done) => setTimeout(done, 750))
  }
  // The fake echoes the arguments it received, so the check reads them from the host's own answer rather
  // than from a file the fake rewrites on a timer.
  const echo = response.json?.output?.output ?? response.json?.output ?? {}
  const sent = echo.arguments ?? (fakeCalls ?? []).map((entry) => entry.arguments ?? entry).pop() ?? {}
  const text = JSON.stringify(response.json ?? {})
  const appended = /Cost:/.test(text)
  const capped = caseDef.max === undefined || Number(sent.max_results) === caseDef.max
  const state = response.ok && capped && appended ? "pass" : "fail"
  return {
    id,
    kind: "capped",
    state,
    detail: `rpc ${response.status} ${String(response.text ?? "").slice(0, 120)}; the server received max_results ${JSON.stringify(sent.max_results)}; the result ${appended ? "carries" : "lacks"} the appended line`,
    evidence: { status: response.status, sent, appended },
  }
}
