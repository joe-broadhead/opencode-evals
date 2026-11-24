// The guard's decisions, pure: the policy, the call and the plans recorded so far go in, a verdict comes out. Plain JavaScript,
// so the harness's tests import it as it is and the plugin (index.ts) imports it unchanged inside the host.

import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const INVALID = { mode: "refuse", writes: [], actions: [], invalid: true }

const strings = (value) => Array.isArray(value) && value.every((v) => typeof v === "string" && v.length > 0)
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

/** Validate before installing hooks: an empty fallback must never classify every call as a read. */
export function validPolicy(p, inventory = p?.inventory) {
  if (!object(p) || !["refuse", "log", "commit"].includes(p.mode) || !Array.isArray(p.writes) || !strings(p.actions) || !strings(p.known)) return false
  if (!object(inventory) || !Array.isArray(inventory.reads) || !Array.isArray(inventory.writes)) return false
  const entries = [...inventory.reads, ...inventory.writes]
  if (!entries.every((entry) => object(entry) && typeof entry.action === "string" && entry.action.length > 0 && strings(entry.names) && entry.names.length > 0 && entry.names.includes(entry.action))) return false
  const unique = (values) => new Set(values).size === values.length
  if (!unique(entries.map((entry) => entry.action))) return false
  const reads = new Set(inventory.reads.flatMap((entry) => entry.names))
  const writeNames = new Set(inventory.writes.flatMap((entry) => entry.names))
  if ([...reads].some((name) => writeNames.has(name))) return false
  const sameSet = (a, b) => {
    const left = new Set(a), right = new Set(b)
    return left.size === a.length && right.size === b.length && left.size === right.size && a.every((item) => right.has(item))
  }
  if (!sameSet(p.known, [...new Set([...reads, ...writeNames])])) return false
  if (!sameSet(p.actions, inventory.writes.map((entry) => entry.action))) return false
  if (!p.writes.every((w) => object(w) && strings(w.names) && w.names.length > 0 && typeof w.action === "string" && w.action.length > 0 &&
    (w.extract === undefined || (typeof w.extract === "string" && w.extract.length > 0)) &&
    (w.allow === undefined || strings(w.allow)) && (w.local === undefined || typeof w.local === "boolean"))) return false
  if (!sameSet(p.writes.map((w) => w.action), inventory.writes.map((entry) => entry.action))) return false
  const byAction = new Map(inventory.writes.map((entry) => [entry.action, entry]))
  if (p.writes.some((w) => {
    const entry = byAction.get(w.action)
    return !entry || !sameSet(w.names, entry.names)
  })) return false
  if (p.tools !== undefined && (!object(p.tools) || !strings(p.tools.exact) || !strings(p.tools.prefixes))) return false
  if (p.plans !== undefined && (!object(p.plans) || !strings(p.plans.makers) || !strings(p.plans.committers) || !strings(p.plans.targetPaths) || !strings(p.plans.allow) ||
    (p.plans.idPath !== undefined && typeof p.plans.idPath !== "string") || (p.plans.commitKey !== undefined && typeof p.plans.commitKey !== "string"))) return false
  return true
}

/** Invalid or unreadable policy blocks every call, including the outer execute. */
export function loadPolicy(file) {
  try {
    const path = typeof file === "string" ? file : fileURLToPath(file)
    if (!existsSync(path)) return { ...INVALID }
    const policy = JSON.parse(readFileSync(path, "utf8"))
    const inventory = JSON.parse(readFileSync(join(dirname(path), "inventory.json"), "utf8"))
    return validPolicy(policy, inventory) ? { ...policy, inventory } : { ...INVALID }
  } catch {
    return { ...INVALID }
  }
}

/** `args.channel_id`, `args.items.0.to`: a dotted path into a call's input. */
export function pick(input, path) {
  let at = input
  for (const part of String(path).replace(/^args\./, "").split(".")) {
    if (at === null || at === undefined) return undefined
    at = at[part]
  }
  return at
}

/**
 * What a trial's grader may know of a write without the whole call: the scalar leaves of its input (`{ "folder_id": "fld_9f3a21", "items.0.to": "x" }`), at most `max` of them,
 * each cut to 200 characters. Logged for a write at `execute.before`, so a clause can read the value the tool REALLY got (a variable resolved), not only what the script's text
 * said. Private like the rest of the guard's log.
 */
export function scalarLeaves(value, { max = 60, depth = 6 } = {}) {
  const out = {}
  const walk = (at, path, d) => {
    if (Object.keys(out).length >= max || d > depth || at === null || at === undefined) return
    if (typeof at === "string" || typeof at === "number") out[path] = String(at).slice(0, 200)
    else if (Array.isArray(at)) at.forEach((item, i) => walk(item, path ? `${path}.${i}` : String(i), d + 1))
    else if (typeof at === "object") for (const [key, child] of Object.entries(at)) walk(child, path ? `${path}.${key}` : key, d + 1)
  }
  walk(value, "", 0)
  return out
}

/** Looks like an id the vendor assigned: at least 8 characters, a digit among them, no space (`fld_9f3a21b7`, a UUID, a Slack ts). Words and small numbers are not. */
export const ID_SHAPE = /^(?=.*\d)[A-Za-z0-9_.:-]{8,}$/

/** The values in a tool's result: parsed from JSON text, an MCP `content` list, or an object. */
function resultValues(result) {
  const parse = (text) => {
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  if (typeof result === "string") return parse(result) ?? result
  if (result && typeof result === "object" && Array.isArray(result.content)) return result.content.map((part) => (typeof part?.text === "string" ? (parse(part.text) ?? part.text) : part))
  return result
}

/** Verbs a write's name starts with: what is left of the name says WHAT it makes (`create_folder`: a folder; `notion-create-pages`: pages; `save_issue`: an issue). */
const WRITE_VERBS = new Set(["create", "save", "add", "new", "update", "upsert", "post", "send", "make", "insert", "write", "set", "duplicate", "copy", "import", "upload", "start", "run", "schedule", "mcp"])

/** The singular and plural spellings of the thing a write makes, from its name: `slack_send_message` -> message, messages. */
export function nounsOf(tool) {
  const words = String(tool).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).filter((word) => !WRITE_VERBS.has(word))
  return [...new Set(words.flatMap((word) => [word, word.endsWith("ies") ? `${word.slice(0, -3)}y` : word.endsWith("s") ? word.slice(0, -1) : `${word}s`]))]
}

/** Keys that wrap a result without being a thing of their own: an id inside one of them is the written thing's. */
const ENVELOPE = new Set(["result", "results", "data", "item", "items", "created", "record", "records", "object", "objects", "entity", "payload", "response", "output", "content"])

/**
 * The ids a WRITE's own result gives to the thing it made, that the call did not pass in: the value of an `id` field (`id`, `uuid`, `<noun>_id`, `<noun>Id`, the noun being what the write makes)
 * of the written thing, reached only through arrays and envelope keys (`data`, `result`, `items`...) or a key that is the written thing's own name (`{"folder":{"id":...}}` of `create_folder`).
 * NOT an id the result merely names: a parent, an owner, a workspace, a team or project the thing belongs to, a list of ids, a timestamp (review of #14, K1: a result that names
 * `parent_id: fld_realparent9` and `owner: usr_REAL0007` beside the new `id` makes only the `id` new). An update echoes the id it was given, which the input carried, so it adds none. A result that is
 * prose has `id: <value>` or `"id": "<value>"` in it or has none. Nothing a read returned and nothing a failed write returned is ever asked: only a completed write's result.
 */
export function newIds(result, input, { max = 20, tool = "" } = {}) {
  const given = new Set(Object.values(scalarLeaves(input, { max: 500 })))
  const nouns = nounsOf(tool)
  const own = new Set(nouns)
  const idKey = (key) => key === "id" || key === "uuid" || key === "ts" || nouns.some((noun) => key === `${noun}_id` || key === `${noun}Id`)
  const ids = []
  const add = (value) => {
    const text = String(value)
    if (ids.length < max && ID_SHAPE.test(text) && !given.has(text) && !ids.includes(text)) ids.push(text)
  }
  const walk = (at, d) => {
    if (ids.length >= max || d > 8 || at === null || at === undefined) return
    if (typeof at === "string") {
      // prose: `id: abc123…` or `"id": "abc123…"`
      if (at.length > 8 && /[\s{[]/.test(at)) for (const m of at.matchAll(/\bid["']?\s*[:=]\s*["']?([A-Za-z0-9_.:-]{8,})/gi)) add(m[1])
      return
    }
    if (Array.isArray(at)) return void at.forEach((item) => walk(item, d + 1))
    if (typeof at !== "object") return
    for (const [key, child] of Object.entries(at)) {
      if (idKey(key) && (typeof child === "string" || typeof child === "number")) add(child)
      else if (child && typeof child === "object" && (ENVELOPE.has(key.toLowerCase()) || own.has(key.toLowerCase()))) walk(child, d + 1)
    }
  }
  walk(resultValues(result), 0)
  return ids
}

export function matchWrite(policy, tool) {
  const bare = String(tool).replace(/^mcp[._-]/, "")
  return policy.writes.find((write) => write.names.includes(tool) || write.names.includes(bare)) ?? null
}

export const isIn = (names, tool) => Boolean(names?.includes(tool) || names?.includes(String(tool).replace(/^mcp[._-]/, "")))

/** The planId a plan-maker returned, wherever it lies in its result (an object, or JSON text). */
export function planIdOf(result, idPath = "planId") {
  const seen = (value, depth) => {
    if (depth > 4 || value === null || value === undefined) return null
    if (typeof value === "string") {
      try {
        return seen(JSON.parse(value), depth + 1)
      } catch {
        return null
      }
    }
    if (typeof value !== "object") return null
    const direct = pick(value, idPath)
    if (typeof direct === "string" && direct) return direct
    for (const child of Object.values(value)) {
      const found = seen(child, depth + 1)
      if (found) return found
    }
    return null
  }
  return seen(result, 0)
}

/**
 * Decides one call that reached execute.before. Outside the commit set writes are blocked before the tool can ask.
 * In the commit set a write passes only for a declared extractor and an allowed target, a plan commit only for a recorded plan.
 */
/** Is `tool` one a locked trial may call: Code Mode's `execute`, `skill`, `question`, or a tool of a pack's plugin (`<plugin>_...`)? */
export const toolAllowed = (tools, tool) => {
  const name = String(tool).replace(/^mcp[._-]/, "")
  return tools.exact.includes(name) || tools.prefixes.some((prefix) => name.startsWith(`${prefix}_`) || name.startsWith(`${prefix}.`))
}

/**
 * Is `name` unclassified by the packs? The eval-only probe's tools are the harness's own.
 * Such a tool is a write by default.
 */
export function isUnknownTool(policy, name) {
  if (!policy.known) return false
  const bare = String(name).replace(/^mcp[._-]/, "")
  if (["execute", "skill", "question", "todowrite"].includes(bare) || bare.startsWith("evalsprobe_") || bare.startsWith("evalsprobe.") || policy.known.includes(bare) || matchWrite(policy, bare)) return false
  return true
}

export function decideBefore(policy, tool, input, plans = new Map()) {
  if (policy.invalid || !validPolicy(policy)) return { pass: false, why: "the guard policy is invalid or unreadable", tool: true, write: null, committer: false }
  // The allow-list tripwire (G0 review 3.1): the lockdown removes the core tools it knows by name, and a core tool a later version adds
  // stays available. In a locked trial a tool outside this list is refused and logged, whatever it is.
  if (policy.tools && !toolAllowed(policy.tools, tool)) return { pass: false, why: "a core tool outside the locked allow-list", tool: true, write: null, committer: false }
  const write = matchWrite(policy, tool)
  const committer = isIn(policy.plans?.committers, tool)
  // A tool no pack lists is a write by default.
  if (!write && !committer && isUnknownTool(policy, tool)) {
    return { pass: false, why: policy.mode === "commit" ? "a tool no pack lists, and the commit set does not name it" : "an unclassified tool is blocked before execution", tool: true, write: { unknown: true }, committer }
  }
  if (!write && !committer) return { pass: true, why: "not a write", write, committer }
  if (policy.mode !== "commit") return { pass: false, why: "a write is blocked before execution outside commit mode", write, committer }
  if (committer && policy.plans) {
    const id = pick(input, policy.plans.commitKey ?? "planId")
    const plan = typeof id === "string" ? plans.get(id) : undefined
    return plan?.ok ? { pass: true, why: "a recorded in-sandbox plan", write, committer } : { pass: false, why: plan ? "a plan whose target is outside the sandbox" : "a plan id the guard never saw made", write, committer }
  }
  // A write that touches only the trial's own sandbox (charts_render's files, a timer in the project) has no external target to
  // check: the commit plan says so with `local: true`, per action, and nothing else is let through without an extractor.
  if (write?.local === true) return { pass: true, why: "a write that touches only the trial's own sandbox", write, committer }
  if (!write || !write.extract || !write.allow?.length) return { pass: false, why: "no target extractor declared for this write", write, committer }
  const target = pick(input, write.extract)
  if (target === undefined || target === null || target === "") return { pass: false, why: "no target in the call", write, committer }
  if (Array.isArray(target) && target.length === 0) return { pass: false, why: "no target in the call", write, committer }
  if (!(Array.isArray(target) ? target : [target]).every((value) => typeof value === "string" && value.length > 0)) return { pass: false, why: "invalid target in the call", write, committer }
  const list = Array.isArray(target) ? target.map(String) : [String(target)]
  const outside = list.filter((value) => !write.allow.includes(value))
  return outside.length ? { pass: false, why: "a target outside the sandbox", write, committer } : { pass: true, why: "an in-scope target", write, committer }
}

/** A plan the guard saw made: in scope when every target it names is an allowed alias value. */
export function judgePlan(policy, input) {
  const targets = (policy.plans?.targetPaths ?? []).flatMap((path) => {
    const value = pick(input, path)
    return value === undefined || value === null ? [] : Array.isArray(value) ? value.map(String) : [String(value)]
  })
  return { ok: targets.length > 0 && targets.every((target) => (policy.plans?.allow ?? []).includes(target)), targets: targets.length }
}
