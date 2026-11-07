// The inner-call analyser: what a run actually did, including the calls written inside Code Mode's
// `execute` tool.
//
// A `tool_use` event's own status is only the outer status: `execute` reads "completed" even when a call
// inside it was declined (the runner auto-rejects every permission ask) or failed (a tool error, an HTTP
// status, a thrown error). So the outer counts alone report "failed 0" for a run that was declined or hit
// a 504. These functions read the inner failures from the execute code and its output.
//
// Promoted from the review loop's eval-counts.mjs, with its semantics and its replay test
// kept: see test/analyse-replay.test.mjs. Everything here parses recorded JSON; it never starts a session.

// `opencode run` rejects every permission ask with this text, and the execute call still ends "completed".
export const DECLINED_MARKER = "cannot ask the user for permission, so the request was rejected"

const TOOL_CALL = /tools(?:\.[A-Za-z_$][\w$]*|\["[^"]+"\])+\s*\(/g
// An MCP tool's failure replaced the output, e.g.:
//   MCP tool "list_job_posts" on server "metaview" failed: Error POSTing to endpoint: … (HTTP 504)
const MCP_FAILED = /MCP tool "([^"]+)" on server "([^"]+)" failed: ([^\n]*)/g
const HTTP_STATUS = /\(HTTP (\d{3})\)/
// Code Mode's own thrown error, which also leaves the outer call "completed":
//   ReferenceError: Unknown identifier 'BigInt'. (line 2, col 66)
const CODE_ERROR = /^[A-Za-z]*(?:Error|Exception): [^\n]*\(line \d+, col \d+\)$/
// `opencode run` prints one of these to stderr per auto-rejected ask, which names the tool that was declined.
const ASK_LINE = /permission requested: (\S+)/g
const ANSI = /\u001b\[[0-9;]*m/g

const MAX_MESSAGE = 300

export function countOccurrences(text, needle) {
  let n = 0
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) n++
  return n
}

// The output as the strings inside it: a decoded JSON result could hold an error as a value, and a
// JSON-escaped message ("MCP tool \"x\" …") would not match the quoted patterns if scanned raw.
export function stringsIn(output) {
  const text = typeof output === "string" ? output : JSON.stringify(output ?? "")
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === "string") return [parsed]
    const out = []
    const walk = (v) => {
      if (typeof v === "string") out.push(v)
      else if (Array.isArray(v)) v.forEach(walk)
      else if (v && typeof v === "object") Object.values(v).forEach(walk)
    }
    walk(parsed)
    return out
  } catch {
    return [text]
  }
}

// One `execute` call: the tool calls its code writes, and the ones that were declined or errored.
// The code count is what the agent asked for: a call in a loop or a dead branch counts once, so treat it
// as a lower bound and read the code when the number matters.
export function innerCounts(code, output) {
  const names = [...(typeof code === "string" ? code : "").matchAll(TOOL_CALL)].map((m) => m[0].replace(/\s*\($/, ""))
  const detail = []
  for (const s of stringsIn(output)) {
    const declinedAt = countOccurrences(s, DECLINED_MARKER)
    for (let i = 0; i < declinedAt; i++) detail.push({ kind: "declined", message: DECLINED_MARKER })
    for (const m of s.matchAll(MCP_FAILED)) {
      detail.push({ kind: "errored", tool: m[1], server: m[2], status: (m[3].match(HTTP_STATUS) ?? [])[1], message: m[0].slice(0, MAX_MESSAGE) })
    }
    const trimmed = s.trim()
    if (CODE_ERROR.test(trimmed) && !detail.some((d) => d.kind === "errored" && d.message === trimmed.slice(0, MAX_MESSAGE))) {
      detail.push({ kind: "errored", tool: "execute", message: trimmed.slice(0, MAX_MESSAGE) })
    }
  }
  // The decline message names no tool; the code does, when it holds exactly one call.
  const solo = names.length === 1 ? names[0].replace(/^tools\./, "") : undefined
  for (const d of detail) if (d.kind === "declined" && solo) d.tool = solo
  const declined = detail.filter((d) => d.kind === "declined").length
  const errored = detail.filter((d) => d.kind === "errored").length
  return { names, calls: names.length, declined, errored, failures: declined + errored, detail }
}

// A code path (`metaview.send_job_post_message`) and a stderr ask (`metaview_send_job_post_message`) name
// the same tool, so compare them with punctuation flattened.
export const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_")
export const sameTool = (a, b) =>
  Boolean(norm(a) && norm(b)) && (norm(a) === norm(b) || norm(a).endsWith(`_${norm(b)}`) || norm(b).endsWith(`_${norm(a)}`))

export function askedTools(stderr) {
  return [...String(stderr ?? "").replace(ANSI, "").matchAll(ASK_LINE)].map((m) => m[1])
}

/** The tool name a `tools.<ns>.<name>(…)` call site names, without the `tools.` prefix. */
export const siteName = (site) => String(site).replace(/^tools\./, "").replace(/[[\]"]/g, "").replace(/\./g, ".")

/** Parses JSONL events; a malformed line is skipped, never guessed at. */
export function parseEvents(lines) {
  return lines
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

// The whole run: outer calls and failures as before, plus the inner ones, which the outer status hides.
// Additions over eval-counts.mjs: per-call timestamps, per-step durations, and an explicit `via` label.
export function summarize(lines, stderr = "") {
  const events = parseEvents(lines)
  const calls = []
  const innerDetail = []
  let innerCalls = 0
  let innerDeclined = 0
  let innerErrored = 0
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  // One entry per model call: the provider's own cost (if it reported one) and the split counters.
  const stepCosts = []
  let text = ""
  let sessionID
  let steps = 0
  let firstAt
  let lastAt
  for (const e of events) {
    if (e.sessionID) sessionID ??= e.sessionID
    if (typeof e.timestamp === "number") {
      firstAt ??= e.timestamp
      lastAt = e.timestamp
    }
    if (e.type === "step_finish") {
      steps++
      const t = e.part?.tokens ?? {}
      stepCosts.push({ cost: typeof e.part?.cost === "number" ? e.part.cost : null, tokens: { input: t.input ?? 0, output: t.output ?? 0, cache: { read: t.cache?.read ?? 0, write: t.cache?.write ?? 0 } } })
      tokens.input += t.input ?? 0
      tokens.output += t.output ?? 0
      tokens.cacheRead += t.cache?.read ?? 0
      tokens.cacheWrite += t.cache?.write ?? 0
      tokens.reasoning += t.reasoning ?? 0
    }
    if (e.type === "text") text = e.part?.text ?? text
    if (e.type !== "tool_use") continue
    const p = e.part ?? {}
    const st = p.state ?? {}
    const input = st.input ?? {}
    const out = typeof st.output === "string" ? st.output : JSON.stringify(st.output ?? st.error ?? "")
    const inner = typeof input.code === "string" ? innerCounts(input.code, st.output ?? st.error ?? "") : undefined
    if (inner) {
      innerCalls += inner.calls
      innerDeclined += inner.declined
      innerErrored += inner.errored
      for (const d of inner.detail) innerDetail.push({ call: calls.length, tool: p.tool, ...d })
    }
    calls.push({
      tool: p.tool,
      via: p.tool === "execute" ? "execute" : "direct",
      status: st.status,
      at: e.timestamp,
      inner: inner?.names ?? [],
      input: JSON.stringify(input).slice(0, 1500),
      inputRaw: input,
      outputBytes: out.length,
      outputRaw: st.output ?? st.error ?? "",
      error: st.status === "error" ? String(st.error ?? out).slice(0, MAX_MESSAGE) : undefined,
    })
  }
  // A declined ask always prints to stderr, so it catches a decline the agent swallowed out of its output.
  const asked = askedTools(stderr)
  const declinedDetail = innerDetail.filter((d) => d.kind === "declined")
  for (const d of declinedDetail) {
    const i = d.tool ? asked.findIndex((a) => sameTool(a, d.tool)) : -1
    if (i >= 0) asked.splice(i, 1)
    else if (!d.tool && asked.length) d.tool = asked.shift()
  }
  for (const tool of asked) {
    innerDeclined++
    innerDetail.push({ call: null, tool, kind: "declined", source: "stderr", message: "permission requested, auto-rejecting" })
  }
  const skills = calls
    .filter((c) => c.tool === "skill")
    .map((c) => {
      try {
        return JSON.parse(c.input).id ?? JSON.parse(c.input).name
      } catch {
        return c.input
      }
    })
  return {
    sessionID,
    skillsLoaded: skills,
    toolCalls: calls.length,
    failedCalls: calls.filter((c) => c.status === "error").length,
    inner: { calls: innerCalls, declined: innerDeclined, errored: innerErrored, failures: innerDeclined + innerErrored, detail: innerDetail },
    calls,
    tokens,
    stepCosts,
    steps,
    firstAt,
    lastAt,
    finalText: text,
  }
}
