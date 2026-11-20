// What `evals compile` checks that case reviews kept finding by hand, round after round:
//
//   argumentProblems   every argument path a clause names (`args.<name>` in call:, target:, absent-arg:) must exist in that tool's input, in the pack's recorded parameters
//                      (packs/<id>/inputs.json, built by scripts/capture-inputs.mjs; nested through object properties and array items). An unknown name is refused with the tool's
//                      real parameters: `args.text` on a tool whose parameter is `message` can never match, and a blocker on it never passes.
//   contradictions     a case that REQUIRES a call (call:, declined:, first:, before:, or count >= 1 in a blocker) and also FORBIDS the same call (absent:, absent-write: covering it, count == 0)
//                      can never pass: refused, naming both items.
//   valueWarnings      (a warning, not an error) an argument value a case checks that appears in neither its prompt, its seeds, nor the plugin's fixture: the model cannot know it.

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { seedPlugins } from "./schema.mjs"
import { BUILTIN_TOOLS } from "../grade/select.mjs"

const PACKS_DIR = join(import.meta.dirname, "..", "..", "packs")
const norm = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
// A DEMAND is an evidence clause. `na_when` is a condition ("not applicable when the tool was never called"), never a demand, and `evidence_any` offers alternatives: neither is read as one
// (review of #14, C1: `n/a_when: absent:browse.network` beside `call:browse.network#1` is a sound item).
const clausesOf = (item) => (item.evidence ?? []).filter(Boolean)
const allClauses = (item) => [...(item.evidence ?? []), ...(item.evidence_any ?? []).flat(), ...(item.na_when ?? [])]

/** Every pack's recorded parameters: Map plugin id -> { tool name: tree }. */
export function loadInputs(dir = PACKS_DIR) {
  const out = new Map()
  if (!existsSync(dir)) return out
  for (const id of readdirSync(dir)) {
    const file = join(dir, id, "inputs.json")
    if (existsSync(file)) out.set(id, JSON.parse(readFileSync(file, "utf8")))
  }
  return out
}
let cachedInputs = null
const defaultInputs = () => (cachedInputs ??= loadInputs())

const namesOf = (pack, tool) => new Set([tool.name, `${pack.id}_${tool.name}`, tool.permission].filter(Boolean).map(norm))

/** `{ pack, tool }` for a name a clause uses, looking first in the plugins the case owns or seeds, then in every pack (a routing case names siblings). */
export function resolveTool(name, packs, caseObject) {
  if (!name || String(name).includes("*")) return null
  const text = String(name)
  const dot = text.indexOf(".")
  const [ns, bare] = dot > 0 ? [text.slice(0, dot), text.slice(dot + 1)] : [null, text]
  const first = [caseObject.plugin, ...seedPlugins(caseObject.seed)]
  // OpenCode's own tools (`write`, `edit`, `read`, `shell`) are no plugin's: a bare name of one never resolves to a plugin's tool, whichever plugin the case owns or seeds (the grader reads a bare
  // `write` as the built-in, and a case that means a plugin's names its namespace, `gws.write`). Other bare names resolve among the plugins the case owns or seeds, and among the rest only
  // when the case names a namespace or is a routing case, which names siblings.
  if (!ns && new Set(BUILTIN_TOOLS).has(bare)) return null
  const siblings = ns || (caseObject.sets ?? []).includes("route") ? packs.filter((p) => !first.includes(p.id)) : []
  const ordered = [...first.map((id) => packs.find((p) => p.id === id)).filter(Boolean), ...siblings]
  for (const pack of ordered) {
    if (ns && ns !== pack.id && ns !== String(pack.pluginId ?? "").split(".")[0]) continue
    const tool = (pack.tools ?? []).find((t) => namesOf(pack, t).has(norm(bare)))
    if (tool) return { pack, tool }
  }
  return null
}

// ---------------------------------------------------------------------------------------------- argument names

/** Walks `a.b.0.c` through a parameter tree. Returns null when every step exists, else `{ at, names }`: the path that failed and the parameters at that level. */
export function missingStep(tree, path) {
  let node = tree
  const done = []
  let parts = String(path).replace(/^args\./, "").split(".")
  // a parameter with dots in its name (X's `tweet.fields`) is one top-level step
  if (node?.p && !Object.hasOwn(node.p, parts[0])) {
    for (let j = parts.length; j > 1; j--) {
      const joined = parts.slice(0, j).join(".")
      if (Object.hasOwn(node.p, joined)) {
        parts = [joined, ...parts.slice(j)]
        break
      }
    }
  }
  for (const part of parts) {
    if (node?.open) return null
    // `args.query.length`: the length of a list or a string, which the grader reads (a node with parameters of its own has none)
    if (part === "length" && !node?.p) return null
    if (node?.p && Object.hasOwn(node.p, part)) {
      node = node.p[part]
      done.push(part)
      continue
    }
    if (node?.items) {
      // an array: a number picks an item; a name looks inside the items
      node = node.items
      if (/^\d+$/.test(part)) {
        done.push(part)
        continue
      }
      if (node.open) return null
      if (node.p && Object.hasOwn(node.p, part)) {
        node = node.p[part]
        done.push(part)
        continue
      }
    }
    return { at: [...done, part].join("."), names: Object.keys(node?.p ?? {}) }
  }
  return null
}

/** What a pack's recorded schemas cover: `{ have, total, unlisted: [names the vendor's listing to this sign-in lacks], missing: [names with neither] }`. */
export function coverage(pack, inputs = defaultInputs()) {
  const recorded = inputs.get(pack.id)
  const names = (pack.tools ?? []).map((t) => t.name)
  const have = names.filter((n) => recorded?.tools?.[n])
  const unlisted = names.filter((n) => !recorded?.tools?.[n] && recorded?.unlisted?.[n])
  const missing = names.filter((n) => !recorded?.tools?.[n] && !recorded?.unlisted?.[n])
  return { have: have.length, total: names.length, unlisted, missing }
}

export function argumentProblems(caseObject, { packs, inputs = defaultInputs() } = {}) {
  if (!packs?.length) return []
  const problems = []
  const seen = new Set()
  for (const item of caseObject.items ?? []) {
    for (const clause of allClauses(item)) {
      if (!["call", "target", "absent-arg"].includes(clause.kind) || !clause.arg) continue
      const hit = resolveTool(clause.tool, packs, caseObject)
      if (!hit) continue
      const recorded = inputs.get(hit.pack.id)
      const tree = recorded?.tools?.[hit.tool.name]
      if (!tree) {
        // A tool with no recorded schema cannot have an argument checked: refused, so coverage cannot lapse unseen.
        const key = `${item.id}|${hit.pack.id}.${hit.tool.name}|none`
        if (seen.has(key)) continue
        seen.add(key)
        const why = recorded?.unlisted?.[hit.tool.name] ?? "run `node scripts/capture-inputs.mjs` after adding its schema to the plugin's source snapshot or scripts/own-inputs.json"
        problems.push(`${item.id}: ${hit.pack.id}.${hit.tool.name} has no recorded input schema in packs/${hit.pack.id}/inputs.json, so \`${clause.arg}\` cannot be checked (${why}). Drop the argument clause, or use a clause that names no argument`)
        continue
      }
      const missing = missingStep(tree, clause.arg)
      if (!missing) continue
      const key = `${item.id}|${hit.pack.id}.${hit.tool.name}|${clause.arg}`
      if (seen.has(key)) continue
      seen.add(key)
      const params = missing.names.length ? `its parameters here: ${missing.names.join(", ")}` : "it takes no parameters at this level"
      problems.push(`${item.id}: ${hit.pack.id}.${hit.tool.name} has no argument \`${missing.at}\` (${params}; recorded in packs/${hit.pack.id}/inputs.json)`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------------------------- contradictions

/** What a clause demands of the tools it names: `{ require: [...], forbid: [...] }` of `{ tool, kind }`, with the severity of its item. */
function demands(clause, severity) {
  const require = []
  const forbid = []
  switch (clause.kind) {
    case "call":
      if (!clause.arg) require.push({ tool: clause.tool, kind: "call" })
      else if (clause.op === "==" && ["string", "number"].includes(clause.value?.kind)) require.push({ tool: clause.tool, kind: "call-arg", arg: clause.arg, value: String(clause.value.value) })
      break
    case "first":
      require.push({ tool: clause.tool, kind: "first" })
      break
    case "before":
      require.push({ tool: clause.tool, kind: "before" }, { tool: clause.other, kind: "before" })
      break
    case "declined":
      if (clause.tool) require.push({ tool: clause.tool, kind: "declined", action: true })
      break
    case "count": {
      const needs = (clause.op === ">=" && clause.value >= 1) || (clause.op === ">" && clause.value >= 0) || (clause.op === "==" && clause.value >= 1)
      if (needs && severity === "blocker") require.push({ tool: clause.tool, kind: "count" })
      if ((clause.op === "==" && clause.value === 0) || (clause.op === "<=" && clause.value === 0) || (clause.op === "<" && clause.value <= 1)) forbid.push({ tool: clause.tool, kind: "count" })
      break
    }
    case "absent":
      if (clause.n === null || clause.n === 1) forbid.push({ tool: clause.tool, kind: "absent" })
      break
    case "absent-write":
      forbid.push({ ns: clause.ns, kind: "absent-write" })
      break
    case "absent-arg":
      if (clause.op === "==" && ["string", "number"].includes(clause.value?.kind)) forbid.push({ tool: clause.tool, kind: "absent-arg", arg: clause.arg, value: String(clause.value.value) })
      break
    case "absent-declined":
      if (clause.tool) forbid.push({ tool: clause.tool, kind: "absent-declined", action: true })
      break
  }
  return { require, forbid }
}

const globMatches = (glob, name) => {
  const text = String(glob)
  if (!text.includes("*")) return false
  const re = new RegExp(`^${text.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`, "i")
  return re.test(String(name))
}

export function contradictions(caseObject, { packs = [] } = {}) {
  const problems = []
  const asks = []
  const bars = []
  for (const item of caseObject.items ?? []) {
    for (const clause of clausesOf(item)) {
      const d = demands(clause, item.severity)
      for (const r of d.require) if (r.tool) asks.push({ ...r, item: item.id, clause })
      for (const f of d.forbid) bars.push({ ...f, item: item.id, clause })
    }
  }
  const describe = (c) => `${c.clause.kind}:${c.tool ?? c.ns}${c.clause.kind === "count" ? ` ${c.clause.op} ${c.clause.value}` : c.clause.n ? `#${c.clause.n}` : ""}${c.arg ? ` ${c.arg} == ${c.value}` : ""}`
  const seen = new Set()
  // The same tool: resolved to one pack tool, else the same name once normalised, else covered by a glob (`slack.*`, `x_*`).
  const sameTool = (a, b) => {
    const left = resolveTool(a, packs, caseObject)
    const right = resolveTool(b, packs, caseObject)
    if (left && right) return left.pack.id === right.pack.id && left.tool.name === right.tool.name
    if (norm(a) === norm(b)) return true
    return globMatches(b, a) || (left ? [`${left.pack.id}.${left.tool.name}`, `${left.pack.id}_${left.tool.name}`, left.tool.name].some((name) => globMatches(b, name)) : false)
  }
  const WRITEY = /send|create|update|delete|write|post|add|remove|save|set|upload/
  for (const ask of asks) {
    const asked = resolveTool(ask.tool, packs, caseObject)
    for (const bar of bars) {
      if (ask.item === bar.item && ask.clause === bar.clause) continue
      let hit
      if (bar.kind === "absent-write") hit = asked ? asked.pack.id === bar.ns && asked.tool.class === "write" : norm(ask.tool).startsWith(`${norm(bar.ns)}_`) && WRITEY.test(norm(ask.tool))
      else if (bar.kind === "absent-declined") hit = ask.kind === "declined" && sameTool(ask.tool, bar.tool)
      else if (bar.kind === "absent-arg") hit = ask.kind === "call-arg" && ask.arg === bar.arg && ask.value === bar.value && sameTool(ask.tool, bar.tool)
      else hit = sameTool(ask.tool, bar.tool) // absent: and count: forbid every call of the tool, one that is asked and declined included
      if (!hit) continue
      const key = `${describe(ask)}|${describe(bar)}|${ask.item}|${bar.item}`
      if (seen.has(key)) continue
      seen.add(key)
      problems.push(`${ask.item} requires \`${describe(ask)}\` and ${bar.item} forbids it with \`${describe(bar)}\`: no run can satisfy both, so one of them fails every time`)
    }
  }
  return problems
}

// ---------------------------------------------------------------------------------------------- values nobody told the model

// The two fake plugins' fixtures, as one lower-cased text: what a case may check without the prompt saying it (the fixture is the world the model reads).
import * as githubFixture from "../fake/fixtures/github.mjs"
import * as jiraFixture from "../fake/fixtures/jira.mjs"
const fixtureBlob = [githubFixture, jiraFixture].flatMap((m) => Object.values(m).filter((v) => typeof v !== "function").map((v) => JSON.stringify(v))).join("\n").toLowerCase()

/** Warnings (strings): a value a clause checks that is in the prompt, the seeds or the fixture nowhere. `==` on a string or number only: the one comparison that names a value. */
export function valueWarnings(caseObject) {
  const warnings = []
  const known = `${caseObject.prompt ?? ""}\n${caseObject.seed ?? ""}`.toLowerCase()
  const blob = fixtureBlob
  const seen = new Set()
  for (const item of caseObject.items ?? []) {
    for (const clause of allClauses(item)) {
      if (!["call", "absent-arg"].includes(clause.kind) || !clause.arg || clause.op !== "==" || !["string", "number"].includes(clause.value?.kind)) continue
      const value = String(clause.value.value)
      if (value.length < 3) continue
      if (known.includes(value.toLowerCase()) || blob.includes(value.toLowerCase())) continue
      const key = `${item.id}|${clause.tool}|${clause.arg}|${value}`
      if (seen.has(key)) continue
      seen.add(key)
      warnings.push(`${item.id}: ${clause.tool} ${clause.arg} is checked for ${JSON.stringify(value)}, which is in neither the prompt, the seeds nor the plugin's fixture: the model has no way to know it, so it can only pass by luck (or by a value the model finds itself: say so in the prompt)`)
    }
  }
  return warnings
}
