// The evidence grammar: the only way an item may state what it saw.
//
// One clause, one observable. Every clause must be checkable from the normalised trace and the final
// state; a clause that cannot be settled is `unverifiable`, which makes its item BLOCKED — never passed
// and never failed. That distinction is what keeps an infra failure or a variable-valued argument from
// being scored as a defect.

import { selectCalls } from "./select.mjs"

const RE = /^\/(.+)\/([a-z]*)$/

const parseValue = (raw) => {
  const text = raw.trim()
  const re = RE.exec(text)
  if (re) return { kind: "regex", source: re[1], flags: re[2] }
  if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return { kind: "string", value: text.slice(1, -1) }
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return { kind: "number", value: Number(text) }
  if (text === "true" || text === "false") return { kind: "boolean", value: text === "true" }
  return { kind: "string", value: text }
}

const op = (raw) => {
  const text = raw.trim()
  if (text === "==" || text === "=") return "=="
  if (text === "!=") return "!="
  if (text === "<=" || text === ">=" || text === "<" || text === ">") return text
  if (text === "matches" || text === "not-matches" || text === "excludes" || text === "contains") return text
  if (text === "present") return "present"
  return null
}

/**
 * Parses one clause.
 * @returns {{ok: true, clause: object} | {ok: false, why: string}}
 */
export function parseClause(text) {
  const line = String(text ?? "").trim()
  if (!line) return { ok: false, why: "empty clause" }

  let m
  // call:<tool>#<n> [args.<key> <op> <value>]
  m = /^call:([a-z0-9_.*]+)#(\d+)(?:\s+(args\.[A-Za-z0-9_.]+)\s+(\S+)(?:\s+(.+))?)?$/.exec(line)
  if (m) {
    const clause = { kind: "call", tool: m[1], n: Number(m[2]), arg: m[3] ?? null }
    if (m[3]) {
      const operator = op(m[4] ?? "")
      if (!operator) return { ok: false, why: `unknown operator ${JSON.stringify(m[4])} in "${line}"` }
      clause.op = operator
      if (operator !== "present") {
        if (!m[5]) return { ok: false, why: `operator ${operator} needs a value in "${line}"` }
        clause.value = operator === "excludes" ? { kind: "list", values: m[5].split(",").map((s) => s.trim()).filter(Boolean) } : parseValue(m[5])
      }
    }
    return { ok: true, clause }
  }

  m = /^absent:([a-z0-9_.*]+)(?:#(\d+))?$/.exec(line)
  if (m) return { ok: true, clause: { kind: "absent", tool: m[1], n: m[2] ? Number(m[2]) : null } }

  m = /^count:([a-z0-9_.*]+)\s+(<=|>=|==|<|>)\s+(\d+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "count", tool: m[1], op: m[2], value: Number(m[3]) } }

  m = /^counts:([a-z0-9_.*]+)#(\d+)\.([a-z_]+)\s+(<=|>=|==|<|>)\s+(\d+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "counts", tool: m[1], n: Number(m[2]), key: m[3], op: m[4], value: Number(m[5]) } }

  m = /^text:(last-line|any|first-line|first-paragraph)\s+count\s+(\/.+\/[a-z]*)\s+(<=|>=|==|<|>)\s+(\d+)$/.exec(line)
  if (m) {
    const value = parseValue(m[2])
    if (value.kind !== "regex") return { ok: false, why: `text count needs a /regex/ in "${line}"` }
    return { ok: true, clause: { kind: "text-count", span: m[1], op: m[3], value, n: Number(m[4]) } }
  }

  m = /^text:(last-line|any|first-line|first-paragraph)\s+(matches|not-matches)\s+(\/.+\/[a-z]*)$/.exec(line)
  if (m) {
    const value = parseValue(m[3])
    if (value.kind !== "regex") return { ok: false, why: `text clause needs a /regex/ in "${line}"` }
    return { ok: true, clause: { kind: "text", span: m[1], op: m[2], value } }
  }

  m = /^(absent-)?skill:([a-z0-9_.-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: m[1] ? "absent-skill" : "skill", skill: m[2] } }

  m = /^(absent-)?declined:([a-z0-9_.-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: m[1] ? "absent-declined" : "declined", tool: m[2] } }

  m = /^budget:([a-z_]+)\s+(<=|>=|==|<|>)\s+(\d+(?:\.\d+)?)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "budget", name: m[1], op: m[2], value: Number(m[3]) } }

  m = /^cost:matches-appended(?:\s+tolerance\s+(\d+(?:\.\d+)?))?$/.exec(line)
  if (m) return { ok: true, clause: { kind: "cost", tolerance: m[1] ? Number(m[1]) : 0.0011 } }

  m = /^state:([A-Za-z0-9_.-]+)\s+(==|!=)\s+(.+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "state", path: m[1], op: m[2], value: parseValue(m[3]) } }

  return { ok: false, why: `unrecognised clause "${line}"` }
}

const compare = (a, b, operator) => {
  switch (operator) {
    case "==":
      return a === b
    case "!=":
      return a !== b
    case "<=":
      return a <= b
    case ">=":
      return a >= b
    case "<":
      return a < b
    case ">":
      return a > b
    default:
      return false
  }
}

const numberish = (v) => typeof v === "number" && Number.isFinite(v)

/** Where a tool argument lives, as the trace stores it. */
export function argState(args, key) {
  // A call whose whole argument object is a variable (`events_list(args)`) says nothing about its keys: unverifiable, not "missing".
  if (args && typeof args === "object" && "$ref" in args) return { state: "opaque", why: "the argument object is a variable" }
  const path = key.replace(/^args\./, "").split(".")
  let value = args
  for (const part of path) {
    if (value === null || value === undefined || typeof value !== "object") return { state: "missing" }
    value = value[part]
  }
  if (value === undefined || value === null) return { state: "missing" }
  if (typeof value === "object") {
    if (value.kind === "timestamp") return { state: "value", value: value.value }
    if (value.kind === "redacted") return { state: "text", shape: value.shape, tokens: value.tokens ?? [], len: value.len }
    if (value.kind === "code") return { state: "opaque", why: "code body" }
    if (value.kind === "object") return { state: "opaque", why: `object with keys ${(value.keys ?? []).join(",")}` }
    if (value.kind === "id") return { state: "opaque", why: "id" }
    return { state: "opaque", why: "object" }
  }
  return { state: "value", value }
}

const textSpan = (text, span) => {
  if (text === null || text === undefined) return null
  const lines = String(text).split("\n")
  if (span === "last-line") {
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i].trim()) return lines[i]
    return ""
  }
  if (span === "first-line") return lines.find((line) => line.trim()) ?? ""
  if (span === "first-paragraph") {
    const at = String(text).indexOf("\n\n")
    return at < 0 ? String(text) : String(text).slice(0, at)
  }
  return String(text)
}

const pathOf = (object, path) => {
  let value = object
  for (const part of String(path).split(".")) {
    if (value === null || value === undefined || typeof value !== "object") return undefined
    value = value[part]
  }
  return value
}

/**
 * Evaluates one clause against a run view.
 * @returns {{state: "ok"|"fail"|"unverifiable", detail: string}}
 */
export function evaluateClause(clause, view) {
  switch (clause.kind) {
    case "call": {
      const calls = selectCalls(view.calls, clause.tool, view.scope)
      const call = calls[clause.n - 1]
      if (!call) return { state: "fail", detail: `${clause.tool}#${clause.n} was not called (${calls.length} total)` }
      if (!clause.arg) return { state: "ok", detail: `${clause.tool}#${clause.n} called via ${call.via}` }
      if (call.args_parsed === false) return { state: "unverifiable", detail: `${clause.tool}#${clause.n} arguments could not be parsed` }
      const resolved = argState(call.args ?? {}, clause.arg)
      if (resolved.state === "missing") return { state: "fail", detail: `${clause.arg} was not passed` }
      const label = clause.arg.replace(/^args\./, "")
      // The whole argument object is a variable: nothing is known about its keys, `present` included.
      if (resolved.state === "opaque" && resolved.why === "the argument object is a variable") return { state: "unverifiable", detail: `${clause.tool}#${clause.n} arguments are a variable` }
      // "present" is about the call, not the value: a variable was still passed.
      if (clause.op === "present") return { state: "ok", detail: `${label} present` }
      if (resolved.state === "opaque") return { state: "unverifiable", detail: `${clause.arg} is a variable (${resolved.why})` }
      if (resolved.state === "text") {
        if (clause.op === "excludes") {
          const haystack = new Set([...resolved.tokens, ...String(resolved.shape).toLowerCase().split(/[^a-z0-9_-]+/)])
          const hit = clause.value.values.filter((v) => haystack.has(String(v).toLowerCase()))
          return hit.length
            ? { state: "fail", detail: `${label} contains ${hit.join(", ")}` }
            : { state: "ok", detail: `${label} (${resolved.len} chars) contains none of ${clause.value.values.join(", ")}` }
        }
        const shape = String(resolved.shape)
        if (clause.value.kind !== "regex") {
          return { state: "unverifiable", detail: `${label} is redacted; only a /regex/ can be tested against its shape` }
        }
        const re = new RegExp(clause.value.source, clause.value.flags.replace("g", ""))
        const matched = re.test(shape)
        const ok = clause.op === "matches" ? matched : !matched
        return { state: ok ? "ok" : "fail", detail: `${label} shape ${ok ? "matches" : "does not match"} /${clause.value.source}/` }
      }
      const value = resolved.value
      if (clause.value.kind === "regex") {
        const re = new RegExp(clause.value.source, clause.value.flags.replace("g", ""))
        const matched = re.test(String(value))
        const ok = clause.op === "matches" ? matched : !matched
        return { state: ok ? "ok" : "fail", detail: `${label} ${JSON.stringify(value)} ${ok ? "matches" : "does not match"} /${clause.value.source}/` }
      }
      if (clause.op === "excludes") {
        const text = String(value).toLowerCase()
        const hit = clause.value.values.filter((v) => text.includes(String(v).toLowerCase()))
        return hit.length ? { state: "fail", detail: `${label} contains ${hit.join(", ")}` } : { state: "ok", detail: `${label} excludes ${clause.value.values.join(", ")}` }
      }
      const ok = compare(value, clause.value.value, clause.op)
      return { state: ok ? "ok" : "fail", detail: `${label} ${JSON.stringify(value)} ${ok ? "satisfies" : "does not satisfy"} ${clause.op} ${JSON.stringify(clause.value.value)}` }
    }
    case "absent": {
      const count = selectCalls(view.calls, clause.tool, view.scope).length
      if (clause.n === null) {
        return count === 0 ? { state: "ok", detail: `${clause.tool} never called` } : { state: "fail", detail: `${clause.tool} called ${count} time(s)` }
      }
      return count < clause.n
        ? { state: "ok", detail: `${clause.tool} called ${count} time(s), fewer than ${clause.n}` }
        : { state: "fail", detail: `${clause.tool} called ${count} time(s), at least ${clause.n}` }
    }
    case "count": {
      const count = selectCalls(view.calls, clause.tool, view.scope).length
      const ok = compare(count, clause.value, clause.op)
      return { state: ok ? "ok" : "fail", detail: `${clause.tool} called ${count} time(s) ${ok ? "satisfies" : "violates"} ${clause.op} ${clause.value}` }
    }
    case "counts": {
      const calls = selectCalls(view.calls, clause.tool, view.scope)
      const call = calls[clause.n - 1]
      if (!call) return { state: "fail", detail: `${clause.tool}#${clause.n} was not called` }
      const value = call.counts?.[clause.key]
      if (!numberish(value)) return { state: "unverifiable", detail: `${clause.tool}#${clause.n}.counts.${clause.key} not recorded` }
      const ok = compare(value, clause.value, clause.op)
      return { state: ok ? "ok" : "fail", detail: `${clause.tool}#${clause.n}.${clause.key} = ${value} ${ok ? "satisfies" : "violates"} ${clause.op} ${clause.value}` }
    }
    case "text": {
      const span = textSpan(view.answer?.text ?? null, clause.span)
      if (span === null) return { state: "unverifiable", detail: "answer text not available (private recording absent)" }
      const re = new RegExp(clause.value.source, clause.value.flags.replace("g", ""))
      const matched = re.test(span)
      const ok = clause.op === "matches" ? matched : !matched
      return { state: ok ? "ok" : "fail", detail: `answer ${clause.span} ${ok ? "satisfies" : "violates"} ${clause.op} /${clause.value.source}/` }
    }
    case "text-count": {
      const span = textSpan(view.answer?.text ?? null, clause.span)
      if (span === null) return { state: "unverifiable", detail: "answer text not available (private recording absent)" }
      const re = new RegExp(clause.value.source, `${clause.value.flags.replace("g", "")}g`)
      const count = [...String(span).matchAll(re)].length
      const ok = compare(count, clause.n, clause.op)
      return { state: ok ? "ok" : "fail", detail: `answer ${clause.span} has ${count} match(es) of /${clause.value.source}/, ${ok ? "satisfying" : "violating"} ${clause.op} ${clause.n}` }
    }
    case "skill": {
      const loaded = view.skills.includes(clause.skill)
      return loaded ? { state: "ok", detail: `skill ${clause.skill} loaded` } : { state: "fail", detail: `skill ${clause.skill} not loaded` }
    }
    case "absent-skill": {
      const loaded = view.skills.includes(clause.skill)
      return loaded ? { state: "fail", detail: `skill ${clause.skill} was loaded` } : { state: "ok", detail: `skill ${clause.skill} not loaded` }
    }
    case "declined": {
      const hit = view.permissions.filter((p) => p.decision === "declined" && (!clause.tool || sameToolName(p.action, clause.tool)))
      return hit.length ? { state: "ok", detail: `${clause.tool} asked and was declined` } : { state: "fail", detail: `${clause.tool} was never asked` }
    }
    case "absent-declined": {
      const hit = view.permissions.filter((p) => p.decision === "declined" && sameToolName(p.action, clause.tool))
      return hit.length ? { state: "fail", detail: `${clause.tool} was asked and declined` } : { state: "ok", detail: `${clause.tool} never asked` }
    }
    case "budget": {
      const value = view.budget?.[clause.name]
      if (!numberish(value)) return { state: "unverifiable", detail: `budget ${clause.name} not measured` }
      const ok = compare(value, clause.value, clause.op)
      return { state: ok ? "ok" : "fail", detail: `${clause.name} = ${value} ${ok ? "within" : "over"} ${clause.op} ${clause.value}` }
    }
    case "cost": {
      const withLine = view.calls.filter((c) => typeof c.appended?.total_usd === "number")
      if (!withLine.length) return { state: "unverifiable", detail: "the plugin appended no cost line for this run" }
      const appended = withLine[withLine.length - 1].appended.total_usd
      const span = textSpan(view.answer?.text ?? null, "last-line")
      if (span === null) return { state: "unverifiable", detail: "answer text not available (private recording absent)" }
      const amounts = [...String(span).matchAll(/\$(\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]))
      if (!amounts.length) return { state: "fail", detail: `answer last line states no amount (appended $${appended})` }
      const stated = amounts[amounts.length - 1]
      const ok = Math.abs(stated - appended) <= clause.tolerance
      return { state: ok ? "ok" : "fail", detail: `answer states $${stated}; the plugin appended $${appended}` }
    }
    case "state": {
      if (!view.state) return { state: "unverifiable", detail: "no state fixture for this case" }
      const value = pathOf(view.state, clause.path)
      if (value === undefined) return { state: "unverifiable", detail: `state path ${clause.path} absent` }
      const ok = compare(value, clause.value.value, clause.op)
      return { state: ok ? "ok" : "fail", detail: `state ${clause.path} = ${JSON.stringify(value)} ${ok ? "satisfies" : "violates"} ${clause.op} ${JSON.stringify(clause.value.value)}` }
    }
    default:
      return { state: "unverifiable", detail: `unknown clause kind ${clause.kind}` }
  }
}

export const sameToolName = (a, b) => {
  const n = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_")
  const [x, y] = [n(a), n(b)]
  return Boolean(x && y) && (x === y || x.endsWith(`_${y}`) || y.endsWith(`_${x}`))
}
