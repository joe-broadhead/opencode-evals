// The sandbox targets and the canary facts a case names with `@alias` and `@canary.name` (EVALS-232, R5 and R6).
//
// Both live in the private store, never in a repository: `$EVALS_STORE/targets.json` (the owner fills it: ids only) and
// `$EVALS_STORE/canaries.json` (written by the canary seeding). A file may nest (`{ "slack": { "self_dm": "D…" } }`); both
// are read flattened to dotted names (`slack.self_dm`). A value is a string, a number or a list of them; an empty value, a
// placeholder object or a name beginning `_` is not a target. A name the file does not hold is unknown, and a clause that
// needs it is unverifiable, never passed.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { storeRoot } from "../store.mjs"

/** The private store: `$EVALS_STORE`, as every command resolves it. */
export const storeDir = (env = process.env) => storeRoot(env)

/** Flattens nested objects to dotted names; keeps strings, numbers and lists of them. */
export function flatten(value, prefix = "", out = new Map()) {
  if (value === null || value === undefined) return out
  if (Array.isArray(value)) {
    const items = value.filter((item) => typeof item === "string" || typeof item === "number").map(String).filter(Boolean)
    if (items.length && prefix) out.set(prefix, items)
    return out
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) if (!key.startsWith("_")) flatten(child, prefix ? `${prefix}.${key}` : key, out)
    return out
  }
  if ((typeof value === "string" && value) || typeof value === "number") if (prefix) out.set(prefix, [String(value)])
  return out
}

function readJson(file) {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, "utf8"))
  } catch (error) {
    throw new Error(`${file} is not JSON (${error.message})`)
  }
}

/** The targets as a Map name -> [values], or null when the file is absent. */
export function loadTargets(env = process.env) {
  const data = readJson(join(storeDir(env), "targets.json"))
  return data ? flatten(data) : null
}

/** A canary a short or repetitive value cannot be: it is found in ordinary text, and a case that grades it proves nothing. */
export const isWeakCanary = (value) => String(value).length < 8 || new Set(String(value)).size < 5

/** The canaries as a Map name -> [values], or null when the file is absent. */
export function loadCanaries(env = process.env) {
  const data = readJson(join(storeDir(env), "canaries.json"))
  const canaries = data ? flatten(data) : null
  if (canaries) {
    // A canary is a random token: a short or repetitive one is found in ordinary text, and then a case that grades it proves nothing.
    const weak = [...canaries].filter(([, values]) => values.some(isWeakCanary)).map(([name]) => name)
    if (weak.length) throw new Error(`canaries.json: ${weak.sort().join(", ")} must be random tokens of at least 8 characters (with at least 5 different ones): a short canary is found in ordinary text`)
  }
  return canaries
}

/** An alias list (`@gws.doc,@gws.sheet`) as its values, or null when any alias is unknown. */
export function aliasValues(targets, aliases) {
  if (!targets) return null
  const out = []
  for (const alias of aliases) {
    const values = targets.get(String(alias).replace(/^@/, ""))
    if (!values) return null
    out.push(...values)
  }
  return out
}

/** One value as it is compared: trimmed, and lower-cased when it is an address. */
export const norm = (value) => {
  const text = String(value ?? "").trim()
  return text.includes("@") && !/\s/.test(text) ? text.toLowerCase() : text
}

/**
 * A prefix alias (`@boxd.prefix*`) is a grading check that a value starts with a name the owner chose to be theirs alone. So the targets file must DECLARE it a prefix (a name that ends
 * `.prefix` or `_prefix`, or one listed in its `prefixes`), it must be at least 8 characters, and it must end in a separator (`-`, `_`, `.`, `/` or `:`), so `evals-232-` cannot
 * match `evals-2321` and `e` cannot match `engine-prod`. It cannot know whether the owner's real, non-sandbox resources share the prefix: that is the owner's to keep unique, and the
 * guard does not read a prefix (the commit plan takes exact aliases only), so it is not a confinement.
 */
export const MIN_PREFIX = 8
export function prefixAliasProblem(alias, targets) {
  const name = String(alias).replace(/^@/, "")
  const declared = /(?:^|[._])prefix$/.test(name) || (targets?.get("prefixes") ?? []).includes(name)
  if (!declared) return `@${name}* is used as a prefix, but ${name} is not declared one in targets.json (a name ending .prefix or _prefix, or listed in "prefixes")`
  for (const value of targets?.get(name) ?? []) {
    const text = String(value).trim()
    if (text.length < MIN_PREFIX) return `the prefix @${name} is ${text.length} character(s): at least ${MIN_PREFIX}, so it cannot be an ordinary start of a real name`
    if (!/[-_./:]$/.test(text)) return `the prefix @${name} does not end in a separator (- _ . / :): it would match a longer name that merely begins the same`
  }
  return null
}

/** Does `value` start with `prefix` as a name, and stay inside it? A path with a `..` segment or a backslash is not within a prefix, whatever it starts with. */
export function withinPrefix(value, prefix) {
  const text = String(value)
  if (/(^|\/)\.\.(\/|$)/.test(text) || text.includes("\\") || text.includes("\0")) return false
  return text.startsWith(prefix) && text.length > prefix.length
}
