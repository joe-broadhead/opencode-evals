// Privacy by construction: the least `Data:` a case may declare is a floor over the TOOLS it can call, not only over the plugin it tests. A tool that can return content that is not
// in a sandbox (a workspace-wide search or list, a user directory, a transcript, a signed URL, recipients) is marked in its pack's `reach.json` (scripts/reach-marks.mjs), with the
// least label a case that can call it may carry. `evals compile` refuses a lower label. The case reviews kept finding `seeded` and `own` cases whose model could read a real
// workspace: 27 in cases #12, 5 in #10, and ten cross-plugin ones whose COMPANION plugin was the real one. A writer's label is the writer's word; this derives it.
//
// What a case can call:
//   - the plugin it tests: the tools its clauses name (call, first, before, count, counts, target: the tools it relies on), and
//   - every plugin in `Seed: plugins=` that holds a credential: ALL its marked tools. A companion is installed with its real sign-in, so the model can call anything of it, whatever
//     the clauses name. (A fake-mode plugin, GitHub or Jira, has no credential and no real data: no floor.)
// A tool's floor LIFTS only when EVERY call to it is constrained, on the argument that selects what it returns, to a sandbox alias (review of #14, L1 and L2; a clause that grades nothing
// must not remove a floor). The mark names that argument (`scope`: the channel id, the page id, the agent id); a tool with none, or marked `unscopable`, never lifts. The case must have, all
// of them in BLOCKER items and outside `evidence_any` and `n/a_when` (an alternative or a condition constrains nothing):
//   - `count:<tool> <= N` (or `== N`, `< N+1`): the calls are bounded, and
//   - `target:<tool>#n args.<scope> in @<alias>[,@<alias>]` for every n from 1 to N: each call's scope argument is exactly one of those aliases' values.
// The aliases are exact (not `@alias*`, not `created`: a loose match scopes nothing, and a read has no created id), live in the tool's own plugin (`@slack.…` for a Slack tool), and, when the
// store's `targets.json` is at hand, exist in it. `gws read` takes its floor from its operation the same way: `count:gws.read <= N` and `call:gws.read#n args.operation == drive.… / calendar.…`
// for every n are `own`; anything less is `real` (Gmail).
// The least label over all the tools it can call is the case's floor, and the plugin-level minimum (DATA_MINIMUM: granola, plaud, metaview, ...) still applies on top.

import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { DATA_KINDS, seedPlugins } from "./schema.mjs"
import { toolsNamedBy } from "./toolnames.mjs"

const PACKS_DIR = join(import.meta.dirname, "..", "..", "packs")
const norm = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
const rank = (kind) => DATA_KINDS.indexOf(kind)
const clausesOf = (item) => [...(item.evidence ?? []), ...(item.evidence_any ?? []).flat(), ...(item.na_when ?? [])]

/** The marks of every pack that has a `reach.json`: Map plugin id -> { tools: { name: mark } }. */
export function loadReach(dir = PACKS_DIR) {
  const out = new Map()
  if (!existsSync(dir)) return out
  for (const id of readdirSync(dir)) {
    const file = join(dir, id, "reach.json")
    if (existsSync(file)) out.set(id, JSON.parse(readFileSync(file, "utf8")))
  }
  return out
}

let cached = null
const defaultReach = () => (cached ??= loadReach())

/** The names a pack tool answers to, normalised: its own, prefixed by the plugin id, and its permission action. */
const namesOf = (pack, tool) => new Set([tool.name, `${pack.id}_${tool.name}`, tool.permission].filter(Boolean).map(norm))

/** `{ pack, tool }` for a name a clause uses (`slack.slack_search_public`, `slack_search_public`), looking in the plugins the case can reach only, the case's own first. */
function resolve(name, reachable) {
  if (!name || String(name).includes("*")) return null
  const text = String(name)
  const dot = text.indexOf(".")
  const [ns, bare] = dot > 0 ? [text.slice(0, dot), text.slice(dot + 1)] : [null, text]
  for (const pack of reachable) {
    if (ns && ns !== pack.id && ns !== String(pack.pluginId ?? "").split(".")[0]) continue
    const hit = (pack.tools ?? []).find((tool) => namesOf(pack, tool).has(norm(bare)))
    if (hit) return { pack, tool: hit }
  }
  return null
}

/** The plugins a case can reach with a credential: its own, then the companions its `Seed:` lists (no fake-mode plugin: it holds no sign-in and no real data). */
function reachable(caseObject, packs) {
  const own = packs.find((p) => p.id === caseObject.plugin)
  const companions = seedPlugins(caseObject.seed).filter((id) => id !== caseObject.plugin).map((id) => packs.find((p) => p.id === id)).filter(Boolean)
  return { own, list: [own, ...companions].filter((p) => p && p.accounts !== "fake" && p.accounts !== "none"), companions: new Set(companions.map((p) => p.id)) }
}

/** The calls the strong clauses bound: `count:<tool> <= N`, `== N` or `< N+1`; the least N, or null when nothing bounds them. */
function boundOf(demands) {
  const bounds = demands.filter((c) => c.kind === "count").map((c) => (c.op === "<=" || c.op === "==" ? c.value : c.op === "<" ? c.value - 1 : null)).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10)
  return bounds.length ? Math.min(...bounds) : null
}

/** True when the demands bound the calls (`count <= N`) and every call 1..N has a strong clause `ok` that names it (`#n`). */
function everyCallHas(demands, ok) {
  const n = boundOf(demands)
  if (n === null) return false
  for (let call = 1; call <= n; call++) if (!demands.some((c) => c.n === call && ok(c))) return false
  return true
}

/** A target clause whose aliases are exact (no `@alias*`, no `created`), non-empty, in the tool's own plugin, and in the store's targets when it is at hand. */
function exactAliases(clause, plugin, targets) {
  if (clause.created || !clause.aliases?.length) return false
  return clause.aliases.every((alias) => /^@[A-Za-z0-9_.-]+$/.test(alias) && alias.slice(1).startsWith(`${plugin}.`) && (!targets || targets.has(alias.slice(1))))
}

/**
 * The floor of a case: `{ kind, tools: [{ plugin, tool, floor, why }] }` (the tools that set it, the highest first), or null when no tool it can call reaches beyond a sandbox.
 * `reach` is a Map plugin -> marks (the packs' `reach.json` by default).
 */
export function dataFloor(caseObject, { packs, reach = defaultReach(), targets = null } = {}) {
  if (!packs?.length) return null
  const { own, list, companions } = reachable(caseObject, packs)
  if (!own) return null
  // What the case's clauses say about each tool: every clause that names it (what the case can call), and the STRONG ones (an evidence clause of a blocker item: what it demands of every run).
  const named = new Map() // "plugin/tool" -> clauses
  const strong = new Map()
  for (const item of caseObject.items ?? []) {
    const demanded = new Set(item.severity === "blocker" ? (item.evidence ?? []) : [])
    for (const clause of clausesOf(item)) {
      if (!["call", "first", "before", "count", "counts", "target"].includes(clause.kind)) continue
      for (const { tool } of toolsNamedBy(clause)) {
        const hit = resolve(tool, list)
        if (!hit) continue
        const key = `${hit.pack.id}/${hit.tool.name}`
        named.set(key, [...(named.get(key) ?? []), clause])
        if (demanded.has(clause)) strong.set(key, [...(strong.get(key) ?? []), clause])
      }
    }
  }
  const found = []
  for (const pack of list) {
    for (const [name, mark] of Object.entries(reach.get(pack.id)?.tools ?? {})) {
      const key = `${pack.id}/${name}`
      const clauses = named.get(key) ?? []
      // The plugin under test: only the tools the case relies on. A companion: every marked tool.
      if (!companions.has(pack.id) && !clauses.length) continue
      let floor = mark.floor
      const demands = strong.get(key) ?? []
      if (mark.lower && clauses.length && clauses.every((c) => c.kind === "count" || (c.kind === "call" && c.arg === `args.${mark.lower.arg}` && c.op === "==" && new RegExp(mark.lower.pattern).test(String(c.value?.value ?? "")))) && everyCallHas(demands, (c) => c.kind === "call" && c.arg === `args.${mark.lower.arg}` && c.op === "==" && new RegExp(mark.lower.pattern).test(String(c.value?.value ?? "")))) floor = mark.lower.floor
      if (!mark.unscopable && mark.scope && everyCallHas(demands, (c) => c.kind === "target" && c.arg === `args.${mark.scope}` && exactAliases(c, pack.id, targets))) continue
      found.push({ plugin: pack.id, tool: name, floor, why: mark.why, ...(mark.scope && !mark.unscopable ? { scope: mark.scope } : {}) })
    }
  }
  if (!found.length) return null
  found.sort((a, b) => rank(b.floor) - rank(a.floor) || a.plugin.localeCompare(b.plugin) || a.tool.localeCompare(b.tool))
  return { kind: found[0].floor, tools: found }
}

/** What would lift the floor of the tools that set it: the scope argument they have (blocker `target:` clauses for every call, with a `count` bound), or that they have none. */
function lifts(top) {
  const scoped = top.filter((t) => t.scope)
  if (!scoped.length) return "; no clause can lift it: none of these tools has an argument that selects what it returns (or it is a directory or a workspace-wide search)"
  const how = scoped.slice(0, 3).map((t) => `${t.plugin}.${t.tool} by args.${t.scope}`).join(", ")
  return `, or constrain every call of ${how}${scoped.length > 3 ? " and the others" : ""} to a sandbox alias: a blocker \`count:<tool> <= N\` and a blocker \`target:<tool>#n args.<argument> in @<its own plugin's alias>\` for each n of 1..N (not in evidence_any or n/a_when, no \`@alias*\`, no \`created\`)${top.some((t) => !t.scope) ? "; the tools with no such argument never lift" : ""}`
}

/** The problems of a case's `Data:` label against its tools' floors (an array of strings, empty when it is sound). A case with no label, or a legacy one, is not judged here. */
export function reachProblems(caseObject, { packs, reach = defaultReach(), targets = null } = {}) {
  if (!caseObject.data) return []
  const floor = dataFloor(caseObject, { packs, reach, targets })
  if (!floor || rank(caseObject.data) >= rank(floor.kind)) return []
  const top = floor.tools.filter((t) => t.floor === floor.kind)
  const shown = top.slice(0, 3).map((t) => `${t.plugin}.${t.tool} (${t.why})`).join("; ")
  const more = top.length > 3 ? ` and ${top.length - 3} more` : ""
  const companions = [...new Set(top.map((t) => t.plugin).filter((id) => id !== caseObject.plugin))]
  return [`Data: ${caseObject.data} is below this case's floor, ${floor.kind}: it can call ${shown}${more}${companions.length ? `, through ${companions.join(", ")}, a plugin its Seed: plugins= installs with the owner's sign-in` : ""}. Label it ${floor.kind} (Claude only)${lifts(top)}`]
}
