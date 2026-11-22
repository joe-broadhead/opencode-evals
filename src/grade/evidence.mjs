// The evidence grammar: the only way an item may state what it saw.
//
// One clause, one observable. Every clause must be checkable from the normalised trace and the final
// state; a clause that cannot be settled is `unverifiable`, which makes its item BLOCKED — never passed
// and never failed. That distinction is what keeps an infra failure or a variable-valued argument from
// being scored as a defect.

import { selectCalls, qualify } from "./select.mjs"
import { aliasValues, norm, prefixAliasProblem, withinPrefix } from "./targets.mjs"
import { ID_SHAPE } from "../run/guard/logic.mjs"
import { gwsPlanFacts } from "./gws.mjs"
import { writeIndex, writeOf } from "./writes.mjs"
import { fixtureFacts } from "../fake/facts.mjs"
import { memoryCoreEvidence } from "./adapters/mem-core.mjs"
import { memoryDiscoveryEvidence } from "./adapters/mem-discovery.mjs"

const aliasList = (text) => text.split(",").map((part) => part.trim())

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
  m = /^memory-discovery:((?:deep|commit)-mem-[a-z0-9-]+)$/.exec(line)
  if (m) return {ok:true,clause:{kind:"memory-discovery",id:m[1]}}
  m = /^memory-core:(core-[a-z0-9-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "memory-core", id: m[1] } }
  // call:<tool>#<n> [args.<key> <op> <value>]
  m = /^call:([A-Za-z0-9_.*-]+)#(\d+)(?:\s+(args\.[A-Za-z0-9_.-]+)\s+(\S+)(?:\s+(.+))?)?$/.exec(line)
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

  // absent-arg:<tool> args.<key> <op> <value>: no call of the tool passed an argument that satisfies the comparison.
  m = /^absent-arg:([A-Za-z0-9_.*-]+)\s+(args\.[A-Za-z0-9_.-]+)\s+(\S+)(?:\s+(.+))?$/.exec(line)
  if (m) {
    const operator = op(m[3])
    if (!operator) return { ok: false, why: `unknown operator ${JSON.stringify(m[3])} in "${line}"` }
    if (operator === "present") return { ok: true, clause: { kind: "absent-arg", tool: m[1], arg: m[2], op: operator } }
    if (!m[4]) return { ok: false, why: `operator ${operator} needs a value in "${line}"` }
    // A negative comparison is true of every call that did not pass the key: "no call had args.k != v" says nothing useful.
    if (NEGATIVE.has(operator)) return { ok: false, why: `absent-arg takes a positive comparison (==, <, >, matches, contains, present), not ${operator}: "${line}"` }
    return { ok: true, clause: { kind: "absent-arg", tool: m[1], arg: m[2], op: operator, value: parseValue(m[4]) } }
  }

  m = /^absent:([A-Za-z0-9_.*-]+)(?:#(\d+))?$/.exec(line)
  if (m) return { ok: true, clause: { kind: "absent", tool: m[1], n: m[2] ? Number(m[2]) : null } }

  m = /^count:([A-Za-z0-9_.*-]+)\s+(<=|>=|==|<|>)\s+(\d+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "count", tool: m[1], op: m[2], value: Number(m[3]) } }

  m = /^counts:([A-Za-z0-9_.*-]+)#(\d+)\.([a-z_]+)\s+(<=|>=|==|<|>)\s+(\d+)$/.exec(line)
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

  // The files the run wrote, from the recording's files record: exists, absent, or its text matches.
  m = /^file:(\S+)\s+(exists|absent|changed|deleted)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "file", glob: m[1], op: m[2] } }
  m = /^file:(\S+)\s+(matches|not-matches)\s+(\/.+\/[a-z]*)$/.exec(line)
  if (m) {
    const value = parseValue(m[3])
    if (value.kind !== "regex") return { ok: false, why: `file clause needs a /regex/ in "${line}"` }
    return { ok: true, clause: { kind: "file", glob: m[1], op: m[2], value } }
  }

  // Order: the first call (skill loads and the `execute` wrapper aside), and one call before another.
  m = /^first:([A-Za-z0-9_.*-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "first", tool: m[1] } }

  m = /^before:([A-Za-z0-9_.*-]+),([A-Za-z0-9_.*-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "before", tool: m[1], other: m[2] } }

  m = /^(absent-)?skill:([A-Za-z0-9_.-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: m[1] ? "absent-skill" : "skill", skill: m[2] } }

  m = /^(absent-)?declined:([A-Za-z0-9_.-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: m[1] ? "absent-declined" : "declined", tool: m[2] } }

  m = /^budget:([a-z_]+)\s+(<=|>=|==|<|>)\s+(\d+(?:\.\d+)?)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "budget", name: m[1], op: m[2], value: Number(m[3]) } }

  m = /^cost:matches-appended(?:\s+tolerance\s+(\d+(?:\.\d+)?))?$/.exec(line)
  if (m) return { ok: true, clause: { kind: "cost", tolerance: m[1] ? Number(m[1]) : 0.0011 } }

  // R6 (EVALS-232): clauses over the sandbox targets, the plan of a Google Workspace write, the guard and the answer's canaries.
  //   target:<tool>#<n> args.<path> in <where>[,<where>...]   every value of the call's argument is in one of the places:
  //     @<alias>      one of the alias's values (the sandbox targets, exactly)
  //     @<alias>*     starts with one of the alias's values (boxd's machine names: `@boxd.prefix*`, the owner's `evals-232-`)
  //     created       was created in this trial: the value is in the result of an EARLIER WRITE call of the same trial (a page, an issue or a note the model
  //                   made, then used). For a write whose argument has no alias in the store (Granola, Linear and Notion create what they change).
  //                   A read's result does not count: a pre-existing id that a search returned was not created here.
  const WHERE = "(?:@[A-Za-z0-9_.-]+\\*?|created)"
  m = new RegExp(`^target:([A-Za-z0-9_.*-]+)#(\\d+)\\s+(args\\.[A-Za-z0-9_.-]+)\\s+in\\s+(${WHERE}(?:\\s*,\\s*${WHERE})*)$`).exec(line)
  if (m) {
    const places = aliasList(m[4])
    const created = places.includes("created")
    const aliases = places.filter((place) => place !== "created")
    if (aliases.some((a) => a.endsWith("*") && !/^@[A-Za-z0-9_.-]+\*$/.test(a))) return { ok: false, why: `target: a prefix alias is @name* (one trailing star)` }
    return { ok: true, clause: { kind: "target", tool: m[1], n: Number(m[2]), arg: m[3], aliases, ...(created ? { created: true } : {}) } }
  }
  //   gws-plan:#<n> op == <operation>   |   gws-plan:#<n> target in @<alias>[,@<alias>]
  m = /^gws-plan:#(\d+)\s+op\s+(==|!=)\s+([A-Za-z0-9_.+-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "gws-plan", n: Number(m[1]), what: "op", op: m[2], value: m[3] } }
  m = /^gws-plan:#(\d+)\s+target\s+in\s+(@[A-Za-z0-9_.-]+(?:\s*,\s*@[A-Za-z0-9_.-]+)*)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "gws-plan", n: Number(m[1]), what: "target", aliases: aliasList(m[2]) } }
  //   absent-write:<ns>   no call of any write tool of the plugin, declined or not
  m = /^absent-write:([A-Za-z0-9_-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "absent-write", ns: m[1] } }
  //   committed-write:none   no write call was committed (declined and refused ones are not)
  if (line === "committed-write:none") return { ok: true, clause: { kind: "committed-write" } }
  //   guard:clean   the guard ran and refused no in-scope write, saw no access assertion and no committed write outside the set
  if (line === "guard:clean") return { ok: true, clause: { kind: "guard" } }
  //   unknown-tool:none   no call named a tool that does not exist
  if (line === "unknown-tool:none") return { ok: true, clause: { kind: "unknown-tool" } }
  //   text:<span> contains @canary.<name>   the answer states the seeded fact (every value, for a list)
  m = /^text:(last-line|any|first-line|first-paragraph)\s+contains\s+@canary\.([A-Za-z0-9_.-]+)$/.exec(line)
  if (m) return { ok: true, clause: { kind: "canary", span: m[1], name: m[2] } }

  //   text:<span> contains @fixture.<plugin>.<fact>   the answer states what the harness's fake server holds (fake mode): an answer
  //   that was invented, not read from the fixture, does not (every value, for a list). The fact must exist in the fixture.
  m = /^text:(last-line|any|first-line|first-paragraph)\s+contains\s+@fixture\.([a-z][a-z0-9-]*)\.([A-Za-z0-9_]+)$/.exec(line)
  if (m) {
    const facts = fixtureFacts(m[2])
    if (!facts) return { ok: false, why: `@fixture.${m[2]}.${m[3]}: no fake fixture for ${m[2]} (fake mode: ${fixtureFacts.known().join(", ")})` }
    if (!(m[3] in facts)) return { ok: false, why: `@fixture.${m[2]}.${m[3]} is not a fact of the ${m[2]} fixture (${Object.keys(facts).join(", ")})` }
    return { ok: true, clause: { kind: "fixture", span: m[1], plugin: m[2], name: m[3] } }
  }

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

/** A path glob: `*` within a directory, `**` across them. */
const globRe = (glob) => new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\u0000/g, ".*")}$`)

/** The shapes the trace stores in place of a value (redact.mjs). */
const WRAPPERS = new Set(["object", "redacted", "code", "id", "timestamp"])

/** The operators a value that was never passed satisfies. */
const NEGATIVE = new Set(["!=", "not-matches", "excludes"])

/** X's parameters carry dots in their names (`tweet.fields`, `user.fields`): `args.tweet.fields` names that one top-level argument when the call has it, not `fields` inside `tweet`. */
const collapseTop = (args, path) => {
  if (!args || typeof args !== "object" || path[0] in args) return path
  for (let j = path.length; j > 1; j--) {
    const joined = path.slice(0, j).join(".")
    if (joined in args) return [joined, ...path.slice(j)]
  }
  return path
}

/** An argument as the recording holds it: the value itself, a list included. */
export function rawArgState(args, key) {
  if (args && typeof args === "object" && "$ref" in args) return { state: "opaque", why: "the argument object is a variable" }
  let value = args
  for (const part of collapseTop(args, key.replace(/^args\./, "").split("."))) {
    if (value === null || value === undefined || typeof value !== "object") return { state: "missing" }
    // A key not written beside a spread (`{...opts, limit: 5}`) may have come from it: unseen, not missing.
    if (value[part] === undefined && value.$spread === true) return { state: "opaque", why: `${part} may come from a spread` }
    value = value[part]
  }
  if (value === undefined || value === null) return { state: "missing" }
  if (typeof value === "object" && !Array.isArray(value)) return "$ref" in value ? { state: "opaque", why: `a variable (${value.$ref})` } : { state: "value", value: JSON.stringify(value) }
  return { state: "value", value }
}

/** Where a tool argument lives, as the trace stores it. */
export function argState(args, key) {
  // A call whose whole argument object is a variable (`events_list(args)`) says nothing about its keys: unverifiable, not "missing".
  if (args && typeof args === "object" && "$ref" in args) return { state: "opaque", why: "the argument object is a variable" }
  const path = collapseTop(args, key.replace(/^args\./, "").split("."))
  let value = args
  for (const [depth, part] of path.entries()) {
    if (value === null || value === undefined || typeof value !== "object") return { state: "missing" }
    // Below the top level the trace keeps a wrapper, not the value. A nested object is `{kind: "object", keys}`: a key it
    // lists is there but unseen, so it is opaque, never missing, and so is anything under a variable (`keys: ["$ref"]`);
    // only a key the wrapper says is absent is missing. A string, an id or a time reduced to its shape is a scalar:
    // a path under it names nothing that was passed (a single query string has no `.length` of phrasings), so a
    // positive clause on it fails, and a negative one cannot be settled: the value it would negate is unseen.
    if (depth > 0 && !Array.isArray(value) && WRAPPERS.has(value.kind)) {
      if (value.kind !== "object") return { state: "missing", under: value.kind }
      const keys = Array.isArray(value.keys) ? value.keys : null
      if (keys && !keys.includes("$ref") && !keys.includes("$spread") && !keys.includes(part)) return { state: "missing" }
      return { state: "opaque", why: `${path.slice(0, depth).join(".")} is kept as ${keys?.includes("$ref") ? "a variable" : `an object with keys ${(keys ?? []).join(",")}`}, not its value` }
    }
    if (value[part] === undefined && value.$spread === true) return { state: "opaque", why: `${part} may come from a spread` }
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

/** One call's argument against a clause's comparison (`call:` and `absent-arg:` share it). */
function argCheck(call, clause, view) {
  const where = clause.n ? `${clause.tool}#${clause.n}` : clause.tool
  if (call.args_parsed === false) return { state: "unverifiable", detail: `${where} arguments could not be parsed` }
  const label = clause.arg.replace(/^args\./, "")
  // A key the case declares checkable is compared with the recording's own value, never the trace's shape.
  const checkable = view.checkable?.has(label.split(".")[0]) ?? false
  if (checkable && call.raw_args === undefined) return { state: "unverifiable", detail: `${label} is checkable, and the recording is not available` }
  const resolved = checkable ? rawArgState(call.raw_args, clause.arg) : argState(call.args ?? {}, clause.arg)
  // An argument that was not passed is not equal to anything and matches nothing: !=, not-matches and excludes hold.
  if (resolved.state === "missing") {
    if (NEGATIVE.has(clause.op) && resolved.under) return { state: "unverifiable", detail: `${label} is a path under a ${resolved.under} value the trace keeps only as a shape` }
    return NEGATIVE.has(clause.op) ? { state: "ok", detail: `${label} was not passed, so it satisfies ${clause.op}` } : { state: "fail", detail: `${clause.arg} was not passed` }
  }
  // The whole argument object is a variable: nothing is known about its keys, `present` included.
  if (resolved.state === "opaque" && resolved.why === "the argument object is a variable") return { state: "unverifiable", detail: `${where} arguments are a variable` }
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
    return { state: ok ? "ok" : "fail", shape: true, detail: `${label} shape ${ok ? "matches" : "does not match"} /${clause.value.source}/` }
  }
  const value = resolved.value
  // A list (several query phrasings) matches when one element does, and excludes when none does.
  const elements = Array.isArray(value) ? value.map((v) => (typeof v === "string" ? v : JSON.stringify(v))) : [typeof value === "string" ? value : String(value)]
  const shown = checkable ? `(${elements.reduce((n, e) => n + e.length, 0)} chars, from the recording)` : JSON.stringify(value)
  if (clause.value.kind === "regex") {
    const re = new RegExp(clause.value.source, clause.value.flags.replace("g", ""))
    const matched = elements.some((element) => re.test(element))
    const ok = clause.op === "matches" ? matched : !matched
    return { state: ok ? "ok" : "fail", detail: `${label} ${shown} ${ok ? "matches" : "does not match"} /${clause.value.source}/` }
  }
  if (clause.op === "excludes") {
    const hit = clause.value.values.filter((v) => elements.some((element) => element.toLowerCase().includes(String(v).toLowerCase())))
    return hit.length ? { state: "fail", detail: `${label} contains ${hit.join(", ")}` } : { state: "ok", detail: `${label} excludes ${clause.value.values.join(", ")}` }
  }
  if (clause.op === "contains") {
    const ok = elements.some((element) => element.toLowerCase().includes(String(clause.value.value).toLowerCase()))
    return { state: ok ? "ok" : "fail", detail: `${label} ${shown} ${ok ? "contains" : "does not contain"} ${JSON.stringify(clause.value.value)}` }
  }
  if (checkable && Array.isArray(value)) {
    const same = JSON.stringify(value) === JSON.stringify(clause.value.value)
    const ok = clause.op === "!=" ? !same : clause.op === "==" ? same : false
    return { state: ok ? "ok" : "fail", detail: `${label} ${shown} ${ok ? "satisfies" : "does not satisfy"} ${clause.op}` }
  }
  const ok = compare(value, clause.value.value, clause.op)
  if (checkable) return { state: ok ? "ok" : "fail", detail: `${label} ${shown} ${ok ? "satisfies" : "does not satisfy"} ${clause.op} ${JSON.stringify(clause.value.value)}` }
  return { state: ok ? "ok" : "fail", detail: `${label} ${JSON.stringify(value)} ${ok ? "satisfies" : "does not satisfy"} ${clause.op} ${JSON.stringify(clause.value.value)}` }
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
  if (clause.kind === "memory-discovery") return memoryDiscoveryEvidence(clause.id,view)
  if (clause.kind === "memory-core") return view.scope?.ns && view.scope.ns !== "mem" ? { state: "unverifiable", detail: "Memory core clause used outside Memory" } : memoryCoreEvidence(clause.id, view)
  switch (clause.kind) {
    case "call": {
      const calls = selectCalls(view.calls, clause.tool, view.scope)
      const call = calls[clause.n - 1]
      if (!call) return { state: "fail", detail: `${clause.tool}#${clause.n} was not called (${calls.length} total)` }
      if (!clause.arg) return { state: "ok", detail: `${clause.tool}#${clause.n} called via ${call.via}` }
      return argCheck(call, clause, view)
    }
    case "absent-arg": {
      const calls = selectCalls(view.calls, clause.tool, view.scope)
      if (!calls.length) return { state: "ok", detail: `${clause.tool} never called` }
      const checks = calls.map((call) => argCheck(call, clause, view))
      const hit = checks.findIndex((c) => c.state === "ok")
      if (hit >= 0) return { state: "fail", detail: `${clause.tool}#${hit + 1}: ${checks[hit].detail}` }
      // A value the trace keeps only as its shape, and whose shape does not match, may still have matched: unseen, not absent.
      const unseen = checks.findIndex((c) => c.state === "unverifiable" || c.shape)
      if (unseen >= 0) return { state: "unverifiable", detail: `${clause.tool}#${unseen + 1}: ${checks[unseen].detail}` }
      return { state: "ok", detail: `none of ${calls.length} ${clause.tool} call(s) had ${clause.arg.replace(/^args\./, "")} ${clause.op}${clause.value ? ` ${clause.value.kind === "regex" ? `/${clause.value.source}/` : JSON.stringify(clause.value.value)}` : ""}` }
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
    case "file": {
      if (!Array.isArray(view.files)) return { state: "unverifiable", detail: "no record of the files this run wrote" }
      const re = globRe(clause.glob)
      const present = view.files.filter((file) => re.test(file.path) && file.change !== "deleted")
      if (clause.op === "exists") return present.length ? { state: "ok", detail: `${present.length} file(s) ${clause.glob} written` } : { state: "fail", detail: `no file ${clause.glob} written` }
      if (clause.op === "absent") return present.length ? { state: "fail", detail: `${present.map((f) => f.path).join(", ")} written` } : { state: "ok", detail: `no file ${clause.glob} written` }
      if (clause.op === "changed") return present.some((f) => f.change === "modified") ? { state: "ok", detail: `${clause.glob} modified` } : { state: "fail", detail: `${clause.glob} not modified` }
      if (clause.op === "deleted") return view.files.some((f) => re.test(f.path) && f.change === "deleted") ? { state: "ok", detail: `${clause.glob} deleted` } : { state: "fail", detail: `${clause.glob} not deleted` }
      if (!present.length) return clause.op === "not-matches" ? { state: "ok", detail: `no file ${clause.glob} written` } : { state: "fail", detail: `no file ${clause.glob} written` }
      if (present.some((file) => file.text === undefined)) return { state: "unverifiable", detail: `${clause.glob}: a file is too large or not text` }
      const pattern = new RegExp(clause.value.source, clause.value.flags.replace("g", ""))
      const hit = present.some((file) => pattern.test(file.text))
      const ok = clause.op === "matches" ? hit : !hit
      return { state: ok ? "ok" : "fail", detail: `${clause.glob} ${ok ? "satisfies" : "violates"} ${clause.op} /${clause.value.source}/` }
    }
    case "first": {
      const moves = view.calls.filter((call) => call.tool !== "skill" && call.tool !== "execute")
      if (!moves.length) return { state: "fail", detail: "no tool was called" }
      const ok = selectCalls([moves[0]], clause.tool, view.scope).length === 1
      return { state: ok ? "ok" : "fail", detail: `the first call is ${moves[0].ns ? `${moves[0].ns}.` : ""}${moves[0].tool}` }
    }
    case "before": {
      const at = (pattern) => view.calls.findIndex((call) => selectCalls([call], pattern, view.scope).length === 1)
      const a = at(clause.tool)
      const b = at(clause.other)
      if (b < 0) return { state: "ok", detail: `${clause.other} was never called` }
      if (a < 0) return { state: "fail", detail: `${clause.other} was called and ${clause.tool} never was` }
      return a < b ? { state: "ok", detail: `${clause.tool} came before ${clause.other}` } : { state: "fail", detail: `${clause.other} came before ${clause.tool}` }
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
    case "target": {
      const calls = selectCalls(view.calls, clause.tool, view.scope)
      const call = calls[clause.n - 1]
      if (!call) return { state: "fail", detail: `${clause.tool}#${clause.n} was not called (${calls.length} total)` }
      const exact = clause.aliases.filter((a) => !a.endsWith("*"))
      const prefixed = clause.aliases.filter((a) => a.endsWith("*")).map((a) => a.slice(0, -1))
      // An alias list may be empty (`in created`): then the store is not consulted at all.
      const allowed = exact.length ? aliasValues(view.targets, exact) : []
      const prefixes = prefixed.length ? aliasValues(view.targets, prefixed) : []
      if (!allowed || !prefixes) return { state: "unverifiable", detail: `${clause.aliases.join(", ")} is not in the targets file` }
      // A prefix is a grading check on a name the owner chose to be unique: declared as one, long enough, and ended by a separator (src/grade/targets.mjs).
      for (const alias of prefixed) {
        const bad = prefixAliasProblem(alias, view.targets)
        if (bad) return { state: "unverifiable", detail: bad }
      }
      const label = clause.arg.replace(/^args\./, "")
      let values
      let createdIds = null
      if (clause.created) {
        // `created` reads what the GUARD saw: the value the tool really got (a variable resolved) and the ids the trial's own completed writes returned before this call
        // (src/run/guard: `write_result`: ids a write's result names that its input did not, so an update, a read, a failed write and a script's own invention add none).
        const seen = guardCall(view, clause)
        if (seen.state) return seen
        values = seen.values
        createdIds = seen.ids
        if (!values.length) return { state: "fail", detail: `${label} was not passed` }
      } else {
        if (call.raw_args === undefined) return { state: "unverifiable", detail: `${clause.tool}#${clause.n}: the recording is not available, so the argument cannot be read` }
        const resolved = rawArgState(call.raw_args, clause.arg)
        if (resolved.state === "missing") return { state: "fail", detail: `${label} was not passed` }
        if (resolved.state === "opaque") return { state: "unverifiable", detail: `${label} is a variable (${resolved.why})` }
        values = (Array.isArray(resolved.value) ? resolved.value : [resolved.value]).map(norm)
      }
      const exactSet = new Set(allowed.map(norm))
      const prefixList = prefixes.map(norm)
      const where = (value) => (exactSet.has(value) ? "alias" : prefixList.some((p) => withinPrefix(value, p)) ? "prefix" : createdIds?.includes(value) && ID_SHAPE.test(value) ? "created" : null)
      const hits = values.map(where)
      const ok = values.length > 0 && hits.every(Boolean)
      const names = [...clause.aliases, ...(clause.created ? ["created in this trial"] : [])].join(", ")
      return { state: ok ? "ok" : "fail", detail: `${label} (${values.length} value(s)) ${ok ? "is" : "is not"} in ${names}${ok && hits.includes("created") ? ` (${hits.filter((h) => h === "created").length} returned by an earlier write of this trial)` : ""}` }
    }
    case "gws-plan": {
      const calls = selectCalls(view.calls, "gws.plan", view.scope)
      const call = calls[clause.n - 1]
      if (!call) return { state: "fail", detail: `gws_plan #${clause.n} was not called (${calls.length} total)` }
      if (call.raw_args === undefined) return { state: "unverifiable", detail: `gws_plan #${clause.n}: the recording is not available, so the plan request cannot be read` }
      const facts = gwsPlanFacts(call.raw_args)
      if (clause.what === "op") {
        if (!facts.operation) return { state: "unverifiable", detail: `gws_plan #${clause.n}: ${facts.why ?? "no operation"}` }
        const ok = clause.op === "==" ? facts.operation === clause.value : facts.operation !== clause.value
        return { state: ok ? "ok" : "fail", detail: `gws_plan #${clause.n} operation ${facts.operation} ${ok ? "satisfies" : "violates"} ${clause.op} ${clause.value}` }
      }
      const allowed = aliasValues(view.targets, clause.aliases)
      if (!allowed) return { state: "unverifiable", detail: `${clause.aliases.join(", ")} is not in the targets file` }
      if (!facts.targets.length) return { state: "unverifiable", detail: `gws_plan #${clause.n}: ${facts.why ?? "no target"}` }
      const set = new Set(allowed.map(norm))
      const outside = facts.targets.filter((target) => !set.has(norm(target)))
      return { state: outside.length ? "fail" : "ok", detail: `gws_plan #${clause.n} names ${facts.targets.length} target(s); ${outside.length ? `${outside.length} outside` : "all inside"} ${clause.aliases.join(", ")}` }
    }
    case "absent-write": {
      const index = writeIndex()
      const hit = view.calls.filter((call) => writeOf(call, index) === clause.ns)
      return hit.length ? { state: "fail", detail: `${hit.length} write call(s) of ${clause.ns}: ${[...new Set(hit.map((c) => c.tool))].join(", ")}` } : { state: "ok", detail: `no write call of ${clause.ns}` }
    }
    case "committed-write": {
      // The guard's own record settles it when it ran (it sees every completed write, inner calls included); a direct write
      // call that the trace shows completed settles it too.
      const index = writeIndex()
      const direct = view.calls.filter((call) => call.via !== "execute" && writeOf(call, index) && call.status === "ok")
      if (direct.length) return { state: "fail", detail: `${direct.map((c) => c.tool).join(", ")} completed` }
      if (view.guard?.ran) return view.guard.committed > 0 ? { state: "fail", detail: `the guard saw ${view.guard.committed} write call(s) complete` } : { state: "ok", detail: "the guard saw no write complete" }
      const written = view.calls.filter((call) => writeOf(call, index))
      return written.length ? { state: "unverifiable", detail: `${written.length} write call(s) and no guard record, so whether any was committed is unknown` } : { state: "ok", detail: "no write call was made" }
    }
    case "guard": {
      if (!view.guard?.ran) return { state: "unverifiable", detail: "the guard did not run in this trial" }
      const bad = [view.guard.refused_writes, view.guard.assert_access, view.guard.assert_committed ?? 0].reduce((a, b) => a + (b || 0), 0)
      return bad ? { state: "fail", detail: `the guard logged ${view.guard.refused_writes} refused write(s), ${view.guard.assert_access} access assertion(s), ${view.guard.assert_committed ?? 0} committed write(s)` } : { state: "ok", detail: "the guard refused and asserted nothing" }
    }
    case "unknown-tool": {
      const hit = view.events.filter((event) => (event.kind === "tool_result_error" && event.unknown === true) || (event.kind === "tool_result" && event.error_class === "unknown_tool"))
      return hit.length ? { state: "fail", detail: `${hit.length} call(s) named a tool that does not exist` } : { state: "ok", detail: "every call named a tool that exists" }
    }
    case "fixture": {
      const value = fixtureFacts(clause.plugin)?.[clause.name]
      if (value === undefined) return { state: "unverifiable", detail: `@fixture.${clause.plugin}.${clause.name} is not in the fixture` }
      const span = textSpan(view.answer?.text ?? null, clause.span)
      if (span === null) return { state: "unverifiable", detail: "answer text not available (private recording absent)" }
      const values = [].concat(value).map(String)
      const missing = values.filter((v) => !states(span, v))
      return missing.length ? { state: "fail", detail: `the answer does not state ${missing.length} of ${values.length} value(s) of @fixture.${clause.plugin}.${clause.name}: it was not read from the fixture` } : { state: "ok", detail: `the answer states @fixture.${clause.plugin}.${clause.name}` }
    }
    case "canary": {
      const values = view.canaries?.get(clause.name)
      if (!values) return { state: "unverifiable", detail: `@canary.${clause.name} is not in the canaries file` }
      const span = textSpan(view.answer?.text ?? null, clause.span)
      if (span === null) return { state: "unverifiable", detail: "answer text not available (private recording absent)" }
      const haystack = String(span).toLowerCase()
      const missing = values.filter((value) => !haystack.includes(String(value).toLowerCase()))
      return missing.length ? { state: "fail", detail: `the answer does not state ${missing.length} of ${values.length} value(s) of @canary.${clause.name}` } : { state: "ok", detail: `the answer states @canary.${clause.name}` }
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

/** Does `text` state `value`? A number stands alone (4 is not 14), anything else is a case-insensitive substring. */
function states(text, value, { token = false } = {}) {
  const hay = String(text).toLowerCase()
  const want = String(value).toLowerCase()
  // An id is one token: `ab12` is not in `xab123`.
  if (token) return want.length > 0 && new RegExp(`(^|[^a-z0-9_-])${want.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9_-]|$)`).test(hay)
  return /^\d+$/.test(want) ? new RegExp(`(^|[^0-9])${want}([^0-9]|$)`).test(hay) : hay.includes(want)
}

/**
 * The guard's own record of the call a `created` clause names: the n-th `execute_before` of the tool, its input leaves at the clause's path, and the new ids the completed writes
 * BEFORE it returned. `{ values, ids }`, or `{ state, detail }` when it cannot be read (no guard log; the tool is not a write the guard logs the input of; fewer calls than the clause says).
 */
function guardCall(view, clause) {
  const log = view.guardLog
  if (!Array.isArray(log) || !log.length) return { state: "unverifiable", detail: `${clause.tool}#${clause.n}: the guard's log is not available, so what the trial created cannot be read` }
  const want = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_")
  const pattern = want(qualify(clause.tool, view.scope))
  const befores = log.filter((r) => r.kind === "execute_before" && (want(r.tool) === pattern || want(r.tool).endsWith(`_${pattern}`)))
  const at = befores[clause.n - 1]
  if (!at) return { state: "fail", detail: `the guard saw no call number ${clause.n} of ${clause.tool} (${befores.length} total)` }
  if (!at.args) return { state: "unverifiable", detail: `${clause.tool} is not a write the guard logs the input of: \`created\` is for the writes of a pack` }
  const path = clause.arg.replace(/^args\./, "")
  const values = Object.entries(at.args).filter(([key]) => key === path || key.startsWith(`${path}.`)).map(([, value]) => norm(value))
  const before = log.slice(0, log.indexOf(at))
  return { values, ids: before.filter((r) => r.kind === "write_result").flatMap((r) => r.ids ?? []) }
}
