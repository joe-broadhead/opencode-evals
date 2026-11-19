// Which recorded calls are writes, from the packs (`class: "write"`): for `absent-write:<ns>` and `committed-write:none`.
// A call is matched by every name the trace can give it: its tool, `<ns>_<tool>` and `<ns>.<tool>`, against each pack
// write tool's name, `<plugin>_<name>` and permission action, all normalised (lower case, runs of non-alphanumerics -> `_`).

import { loadPacks } from "../run/lockdown.mjs"

const n = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")

let cache = null
/** { writes: Map<normalised name, plugin id>, known: Set<plugin id> } */
export function writeIndex(packs = null) {
  if (!packs && cache) return cache
  const writes = new Map()
  const known = new Set()
  for (const pack of packs ?? loadPacks()) {
    known.add(pack.id)
    for (const tool of pack.tools ?? []) {
      if (tool.class !== "write") continue
      // A bare name only when it already starts with the plugin's own prefix: `write` and `send` also name host tools and
      // other plugins' reads. A call with a namespace is matched as `<ns>_<tool>` below.
      const names = [`${pack.id}_${tool.name}`, tool.permission]
      if (tool.name.startsWith(`${pack.id}_`)) names.push(tool.name)
      for (const name of names) if (name) writes.set(n(name), pack.id)
    }
  }
  const index = { writes, known }
  if (!packs) cache = index
  return index
}

/** The plugin whose write tool this call is, or null when it is not a write (or not a tool of any pack). */
export function writeOf(call, index = writeIndex()) {
  const candidates = [call.tool, call.ns ? `${call.ns}_${call.tool}` : null, call.ns ? `${call.ns}.${call.tool}` : null].filter(Boolean).map(n)
  for (const name of candidates) {
    const hit = index.writes.get(name)
    if (hit) return hit
  }
  return null
}
