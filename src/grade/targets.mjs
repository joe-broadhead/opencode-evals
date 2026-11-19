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

/** The canaries as a Map name -> [values], or null when the file is absent. */
export function loadCanaries(env = process.env) {
  const data = readJson(join(storeDir(env), "canaries.json"))
  const canaries = data ? flatten(data) : null
  if (canaries) {
    // A canary is a random token: a short or repetitive one is found in ordinary text, and then a case that grades it proves nothing.
    const weak = [...canaries].filter(([, values]) => values.some((v) => String(v).length < 8 || new Set(String(v)).size < 5)).map(([name]) => name)
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
