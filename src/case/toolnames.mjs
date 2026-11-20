// A clause that names a tool the plugin does not have can never fire: `absent:send_message` passes for ever when the tool is
// called `slack_send_message`, so a forbidden-action item written against a tool the release dropped is a test that tests nothing.
// This is the compile-time check against the plugin's pack (found by case writer L3 on cases reused from the x corpus):
// every tool a clause names must exist in the case's own pack, with these allowances:
//
//   - OpenCode's own tools (`shell`, `read`, `write`, `skill`, `execute`, ...): `BUILTIN_TOOLS` in select.mjs;
//   - a namespace or a glob (`slack.*`, `x_*`): its prefix must be a plugin or the start of a tool name;
//   - in a case of set `route` (should-not-call and overlap routing), a tool of a SIBLING plugin: that is what the case is about;
//   - in any case, a tool of a COMPANION: a plugin its `Seed: plugins=` lists (a deep case that summarises an interview and posts the action items to Slack
//     names Slack's send, to grade it). It is checked against the companion's own pack like the case's plugin's tools; a plugin the case does not seed stays refused;
//   - a plugin's hidden tool is not reachable and is refused like an unknown one.
//
// Only a case in one of this round's sets is checked: the earlier corpora (history, x, charts) were written against their own
// declarations and stay as they are.

import { BUILTIN_TOOLS } from "../grade/select.mjs"
import { ROUND_SETS, seedPlugins } from "./schema.mjs"
import { loadInputs, missingStep, resolveTool } from "./consistency.mjs"

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
      // `declined:` compares action names in their normal form (case and punctuation aside); every other clause compares exactly.
      return clause.tool ? [{ tool: clause.tool, loose: true }] : []
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
export function toolNameProblems(caseObject, packs, { inputs = null } = {}) {
  // The pack's recorded parameters (packs/<id>/inputs.json, src/case/consistency.mjs): where a tool has them, an argument path is declared or it is not, and `argumentProblems` says which.
  const recorded = inputs ?? loadInputs()
  const sets = caseObject.sets ?? []
  if (!sets.some((name) => name in ROUND_SETS)) return []
  const own = packs.find((p) => p.id === caseObject.plugin)
  if (!own) return [`no pack for plugin ${caseObject.plugin}: its tools cannot be checked`]
  const route = sets.includes("route")
  // The plugins the case seeds as companions: their tools may be named, and are checked against their own packs.
  const companions = new Set(seedPlugins(caseObject.seed).filter((id) => id !== own.id))
  const mayName = (pack) => pack.id === own.id || route || companions.has(pack.id)
  const builtin = new Set(BUILTIN_TOOLS)
  // A tool name in a clause must be spelled as the plugin spells it: `matchesTool` is case-sensitive, so `getjiraissue` for
  // `getJiraIssue` never matches. Only `declined:` (permission actions) reads names loosely.
  const cache = new Map()
  const indexFor = (pack, loose) => {
    const key = `${pack.id}|${loose}`
    if (!cache.has(key)) cache.set(key, new Map((pack.tools ?? []).flatMap((tool) => namesOfTool(pack, tool).map((name) => [loose ? norm(name) : name, tool]))))
    return cache.get(key)
  }
  const find = (pack, name, loose) => indexFor(pack, loose).get(loose ? norm(name) : name)
  const siblings = packs.filter((p) => p.id !== own.id)
  const problems = []
  const seen = new Set()
  const wide = sets.includes("wide")
  for (const item of caseObject.items ?? []) {
    for (const clause of clausesOf(item)) {
      // A wide case is one request for one tool: `call:*#1` (or `slack.*`) passes on any call at all, `skill` included.
      if (wide && ["call", "first", "before"].includes(clause.kind)) for (const name of [clause.tool, clause.kind === "before" ? clause.other : null]) if (name && String(name).includes("*")) problems.push(`${item.id}: ${clause.kind}:${name} is a positive glob in a wide case: it passes on any tool's call. Name the tool`)
      // A blocker in a wide case that rests on an argument path nothing can check (the packs carry no input schema, so `args.chnl` passes
      // the compiler and then never matches) is refused, unless the pack declares the argument (`args` on the tool). `target:` and a `call:`
      // with an argument fail or are unverifiable at grade time, the safe direction, but a blocker that is always unverifiable proves nothing.
      if (wide && item.severity === "blocker" && (clause.kind === "target" || (clause.kind === "call" && clause.arg))) {
        const arg = clause.kind === "target" ? clause.arg : typeof clause.arg === "string" ? clause.arg : clause.arg?.path ?? ""
        const first = String(arg).replace(/^args\./, "").split(/[.\s=<>!]/)[0]
        // The tool, in the case's own plugin or (a deep case's companion) in a plugin it seeds, by the same resolution the argument check uses.
        const ownPack = packs.find((p) => p.id === caseObject.plugin)
        const ownTool = (ownPack?.tools ?? []).find((t) => namesOfTool(ownPack, t).some((n) => norm(n) === norm(clause.tool)))
        const hit = ownTool ? { pack: ownPack, tool: ownTool } : resolveTool(clause.tool, packs, caseObject)
        const pack = hit?.pack
        const tool = hit?.tool
        const tree = tool ? recorded.get(pack.id)?.tools?.[tool.name] : null
        if (tree ? missingStep(tree, `args.${String(arg).replace(/^args\./, "")}`) === null : (tool?.args ?? []).includes(first)) continue
        problems.push(`${item.id}: a blocker in a wide case rests on the argument \`${first}\` of ${clause.tool}, which no signature in the pack declares: a misspelt path would never match. Make it a major item, or declare the tool's \`args\` in its pack`)
      }
      // Nothing checks an argument path against the tool's input (the packs carry no schema), so a misspelt `absent-arg:` path passes for ever.
      if (clause.kind === "absent-arg") {
        const pack = packs.find((p) => p.id === caseObject.plugin)
        const tool = (pack?.tools ?? []).find((t) => namesOfTool(pack, t).some((n) => norm(n) === norm(clause.tool)))
        // Where the pack records the tool's parameters the path is checked at compile (argumentProblems); only a tool with none recorded is still unverifiable.
        if (tool && recorded.get(pack.id)?.tools?.[tool.name]) continue
      }
      if (clause.kind === "absent-arg") problems.push(`${item.id}: absent-arg:${clause.tool} cannot be checked against the tool's signature, so a misspelt path would pass for ever. Use absent:, count: or target:, which fail when the path is wrong`)
    }
  }
  for (const item of caseObject.items ?? []) {
    for (const clause of clausesOf(item)) {
      if (clause.kind === "absent-write" && !packs.some((p) => p.id === clause.ns)) problems.push(`${item.id}: absent-write:${clause.ns} names no plugin`)
      for (const { tool, fixed, loose = false } of toolsNamedBy(clause)) {
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
          // A positive glob on a namespace the case neither owns nor seeds can never be satisfied (no credential, no tools): `call:linear.*#1` with only slack seeded is a vacuous blocker.
          const owner = packs.find((p) => p.id === prefix || String(p.pluginId ?? "").split(".")[0] === prefix)
          if (owner && !mayName(owner) && ["call", "first", "before", "counts"].includes(clause.kind)) problems.push(`${item.id}: ${tool} names ${owner.id}, which this case does not seed (Seed: plugins=${owner.id}) and which is not its own: a positive match on it can never be satisfied`)
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
          const hit = find(pack, name, loose) ?? find(pack, `${pack.id}_${name}`, loose)
          if (!hit || hit.hidden) problems.push(`${item.id}: ${tool} is not a ${hit?.hidden ? "reachable " : ""}tool of ${pack.id} v${pack.version}`)
          else if (!mayName(pack)) problems.push(`${item.id}: ${tool} is a tool of ${pack.id}, not of ${own.id} (only a case in set route, or one whose Seed: plugins= lists ${pack.id}, may name a sibling's tool)`)
          continue
        }
        if (builtin.has(tool)) continue
        const mine = find(own, tool, loose)
        if (mine) {
          if (mine.hidden) problems.push(`${item.id}: ${tool} is hidden by ${own.id} at runtime: no model can call it`)
          continue
        }
        // A companion's tool first (a bare name two plugins share is the seeded one's), then any sibling's, to say whose it is.
        const sibling = siblings.find((p) => mayName(p) && find(p, tool, loose)) ?? siblings.find((p) => find(p, tool, loose))
        if (sibling && mayName(sibling)) {
          if (find(sibling, tool, loose).hidden && !route) problems.push(`${item.id}: ${tool} is hidden by ${sibling.id} at runtime: no model can call it`)
          continue
        }
        problems.push(`${item.id}: ${tool} is not a tool of ${own.id} v${own.version}${sibling ? ` (it is ${sibling.id}'s: only a case in set route, or one whose Seed: plugins= lists ${sibling.id}, may name it)` : ""}`)
      }
    }
  }
  return problems
}
