// What a pack is checked against besides its own release declaration: the tools its release REGISTERS when the host loads it, and the tools a signed-in host LISTS for it. A plugin can register a
// tool its `jelly` declaration does not name, and an MCP-backed plugin passes through whatever its vendor's server lists today (ElevenLabs' lists eight v0.0.9's pack lacks, one of which places
// phone calls). Two sidecars hold the names, and `evals pack` fails a pack that differs from them:
//   packs/<id>/registered.json   what the BUILT release registers when the host loads it, no sign-in (`scripts/registered-tools.mjs`: a scripted trial, `search({ namespace })`)
//   packs/<id>/live.json         what a signed-in host's Code Mode listing shows (`scripts/capture-live.mjs`, read-only: a listing, no tool call)
// A name in either that the pack does not list is a failure, unless `scripts/live-extra.json` says why (a newer build than the pack pins, a vendor tool the pack has not classified). The harness
// treats every such tool as a write regardless (src/run/guard, src/run/lockdown.mjs): the failure is for the pack to be brought up to date, not for the round to be safe.

import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"

const norm = (name) => String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

/** The tool name at the end of a listing path: `tools.jira.getJiraIssue`, `tools.notion["notion-search"]`. */
export const nameOfPath = (path) => {
  const m = /\["([^"]+)"\]$/.exec(String(path)) ?? /\.([A-Za-z0-9_$-]+)$/.exec(String(path))
  return m ? m[1] : null
}

/** Is `name` a tool the pack lists, under its own name or prefixed by the plugin id (a host that strips the prefix)? */
export const inPack = (pack, name) => {
  const names = new Set((pack.tools ?? []).flatMap((tool) => [norm(tool.name), norm(tool.permission)]))
  return names.has(norm(name)) || names.has(norm(`${pack.id}_${name}`))
}

export function readSidecar(root, id, file) {
  const path = join(root, "packs", id, file)
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null
}

export function readExtras(root) {
  const path = join(root, "scripts", "live-extra.json")
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : {}
}

/**
 * The problems of a pack against what its release registers and what a host lists: `{ registered, live }`, each a list of tool names with no place in the pack.
 * A `live` name is excused only by a reason in `extras[<id>][<name>]`; a `registered` one by nothing (the release itself registers it, so the pack must list it).
 */
export function listingProblems(pack, { registered = null, live = null, extras = {} } = {}) {
  const out = { registered: [], live: [], stale: [] }
  for (const name of registered?.names ?? []) if (!inPack(pack, name)) out.registered.push(name)
  for (const name of live?.names ?? []) {
    if (inPack(pack, name)) continue
    if (!extras[pack.id]?.[name]) out.live.push(name)
  }
  // a curated reason for a tool the pack now lists, or the host no longer lists, is out of date
  for (const name of Object.keys(extras[pack.id] ?? {})) if (inPack(pack, name) || (live && !live.names.includes(name))) out.stale.push(name)
  return out
}

/**
 * `packs/<id>/plugin-rules.json` against the pack: what the harness derives its read allows from (src/run/lockdown.mjs `readActions`). It must exist, name the pack's release, and decide every
 * action of the pack (allowed, asked or denied); a pack tool it does not cover would be an ask in a trial (safe), but a recording that has drifted from the pack means it was not rebuilt.
 */
export function ruleProblems(pack, rules) {
  if (!rules) return ["has no plugin-rules.json (EVALS_COMPANIONS=<file> node scripts/plugin-rules.mjs)"]
  const out = [...releaseProblems(pack, rules, "plugin-rules.json")]
  const listed = new Set((pack.tools ?? []).map((t) => t.permission).filter(Boolean))
  const decided = new Set([...(rules.allowed ?? []), ...(rules.asked ?? []), ...(rules.denied ?? [])])
  const missing = [...listed].filter((action) => !decided.has(action))
  if (missing.length) out.push(`plugin-rules.json does not decide ${missing.slice(0, 4).join(", ")}${missing.length > 4 ? ` and ${missing.length - 4} more` : ""}`)
  // the other direction, under the SAME version: an action the rules decide that the pack no longer lists is a rules file of another build of this release (a tool the release dropped)
  const extra = [...decided].filter((action) => !listed.has(action))
  if (extra.length) out.push(`plugin-rules.json decides ${extra.slice(0, 4).join(", ")}${extra.length > 4 ? ` and ${extra.length - 4} more` : ""}, which the pack does not list: it was recorded from another build (node scripts/plugin-rules.mjs)`)
  return out
}

/**
 * A sidecar (registered.json, plugin-rules.json) must have been recorded from THE release the pack records: its version and, under the same version, its commit. A rebuilt or re-tagged
 * release with the same version number differs here, which the version alone would not show (review of #14: not only on an older version).
 */
export function releaseProblems(pack, sidecar, name) {
  const out = []
  const have = sidecar?.release ?? {}
  if (have.version !== pack.version) out.push(`${name} is of v${have.version ?? "?"}, the pack is v${pack.version}`)
  else if (pack.release?.commit && have.commit && have.commit !== pack.release.commit) out.push(`${name} was recorded from ${String(have.commit).slice(0, 7)}, the pack's release ${pack.release.tag ?? `v${pack.version}`} is ${String(pack.release.commit).slice(0, 7)}: another build of the same version`)
  else if (pack.release?.commit && !have.commit) out.push(`${name} records no release commit (rebuild it: it cannot be tied to ${String(pack.release.commit).slice(0, 7)})`)
  return out
}
