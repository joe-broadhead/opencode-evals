// A clause that names a tool the plugin does not have can never fire: `absent:send_message` passes for ever when the tool is
// called `slack_send_message`, so a forbidden-action item written against a tool the release dropped is a test that tests nothing.
// This is the compile-time check against the plugin's pack (found by case writer L3 on cases reused from the x corpus):
// every tool a clause names must exist in the case's own pack, with these allowances:
//
//   - OpenCode's own tools (`shell`, `read`, `write`, `skill`, `execute`, ...): `BUILTIN_TOOLS` in select.mjs;
//   - a namespace or a glob (`slack.*`, `x_*`): its prefix must be a plugin or the start of a tool name;
//   - in a case of set `route` (should-not-call and overlap routing), a tool of a SIBLING plugin: that is what the case is about;
//   - a plugin's hidden tool is not reachable and is refused like an unknown one.
//
// Only a case in one of this round's sets is checked: the earlier corpora (history, x, charts) were written against their own
// declarations and stay as they are.

import { BUILTIN_TOOLS } from "../grade/select.mjs"
import { ROUND_SETS } from "./schema.mjs"

const clausesOf = (item) => [...(item.evidence ?? []), ...(item.evidence_any ?? []).flat(), ...(item.na_when ?? [])]
const norm = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_")

/** Every name a pack tool answers to: its own, prefixed by the plugin id, by its namespace, and its permission action. */
function namesOfTool(pack, tool) {
  const ns = String(pack.pluginId ?? pack.id).split(".")[0]
  const names = new Set([tool.name, `${pack.id}_${tool.name}`, `${ns}_${tool.name}`, tool.permission])
  return [...names].filter(Boolean)
}

/** The tool patterns a clause names, with the kind of clause that named it. */
export function toolsNamedBy(clause) {
  switch (clause.kind) {
    case "call":
    case "absent":
    case "absent-arg":
    case "count":
    case "counts":
    case "target":
      return [{ tool: clause.tool }]
    case "first":
      return [{ tool: clause.tool }]
    case "before":
      return [{ tool: clause.tool }, { tool: clause.other }]
    case "declined":
    case "absent-declined":
      return clause.tool ? [{ tool: clause.tool }] : []
    case "gws-plan":
      return [{ tool: "gws.plan", fixed: true }]
    default:
      return []
  }
}

/**
 * The problems of one compiled case against the packs (an array of strings, empty when it is sound). `packs` are parsed pack.json
 * objects. A case that declares none of this round's sets is not checked.
 */
export function toolNameProblems(caseObject, packs) {
  const sets = caseObject.sets ?? []
  if (!sets.some((name) => name in ROUND_SETS)) return []
  const own = packs.find((p) => p.id === caseObject.plugin)
  if (!own) return [`no pack for plugin ${caseObject.plugin}: its tools cannot be checked`]
  const route = sets.includes("route")
  const builtin = new Set(BUILTIN_TOOLS)
  const index = (pack) => new Map((pack.tools ?? []).flatMap((tool) => namesOfTool(pack, tool).map((name) => [norm(name), tool])))
  const ownIndex = index(own)
  const siblings = packs.filter((p) => p.id !== own.id)
  const problems = []
  const seen = new Set()
  for (const item of caseObject.items ?? []) {
    for (const clause of clausesOf(item)) {
      if (clause.kind === "absent-write" && !packs.some((p) => p.id === clause.ns)) problems.push(`${item.id}: absent-write:${clause.ns} names no plugin`)
      for (const { tool, fixed } of toolsNamedBy(clause)) {
        const key = `${item.id}|${tool}`
        if (seen.has(key) || !tool) continue
        seen.add(key)
        if (fixed && tool === "gws.plan") continue
        const dot = tool.indexOf(".")
        const star = tool.includes("*")
        if (star) {
          // `slack.*` or `x_*`: a namespace of a plugin, or the start of a tool name.
          const prefix = tool.replace(/\*.*$/, "").replace(/[._]$/, "")
          const known = packs.some((p) => p.id === prefix || String(p.pluginId ?? "").split(".")[0] === prefix || (p.tools ?? []).some((t) => norm(t.name).startsWith(norm(prefix)) || norm(`${p.id}_${t.name}`).startsWith(norm(prefix))))
          if (!known && !prefix) continue
          if (!known && !builtin.has(prefix)) problems.push(`${item.id}: ${tool} matches no plugin or tool`)
          continue
        }
        if (dot > 0) {
          const ns = tool.slice(0, dot)
          const name = tool.slice(dot + 1)
          if (ns === "opencode") continue
          const pack = packs.find((p) => p.id === ns || String(p.pluginId ?? "").split(".")[0] === ns)
          if (!pack) {
            problems.push(`${item.id}: ${tool}: no plugin ${ns}`)
            continue
          }
          const hit = index(pack).get(norm(name)) ?? index(pack).get(norm(`${pack.id}_${name}`))
          if (!hit || hit.hidden) problems.push(`${item.id}: ${tool} is not a ${hit?.hidden ? "reachable " : ""}tool of ${pack.id} v${pack.version}`)
          else if (pack.id !== own.id && !route) problems.push(`${item.id}: ${tool} is a tool of ${pack.id}, not of ${own.id} (only a case in set route may name a sibling's tool)`)
          continue
        }
        if (builtin.has(tool)) continue
        const mine = ownIndex.get(norm(tool))
        if (mine) {
          if (mine.hidden) problems.push(`${item.id}: ${tool} is hidden by ${own.id} at runtime: no model can call it`)
          continue
        }
        const sibling = siblings.find((p) => index(p).has(norm(tool)))
        if (sibling && route) continue
        problems.push(`${item.id}: ${tool} is not a tool of ${own.id} v${own.version}${sibling ? ` (it is ${sibling.id}'s: only a case in set route may name it)` : ""}`)
      }
    }
  }
  return problems
}
