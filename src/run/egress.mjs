// The egress allow-list of one batch (R3): the model's hosts, plus the hosts of the plugins that HOLD A CREDENTIAL in this trial
// and that a case in the batch names (`Seed: plugins=a,b`). A case can name a plugin; it can never name a host: the hosts are the
// pack's own `egress` list, which the owner's data fills, and an entry may carry `{target:<alias>}` (a Jira site's host is the
// owner's, from targets.json). Without a credential (no `+profile`) no vendor host is reachable at all.

import { parseSeed, parseSeedList } from "./world.mjs"
import { DEFAULT_ALLOW } from "./container.mjs"

/** The hosts each model family reaches: the Claude Agent provider's, Zen's, OpenRouter's. */
export function modelHosts(model) {
  const family = String(model ?? "").split("/")[0]
  if (family === "claude-agent") return [...DEFAULT_ALLOW]
  if (family === "opencode") return ["opencode.ai"]
  if (family === "openrouter") return ["openrouter.ai"]
  return null
}

/** One pack egress entry with its `{target:alias}` filled, or null when the targets file lacks the alias. */
export function fillHost(entry, targets) {
  let missing = false
  const host = String(entry).replace(/\{target:([A-Za-z0-9_.-]+)\}/g, (_, alias) => {
    const value = targets?.get(alias)?.[0]
    if (!value) missing = true
    return value ?? ""
  })
  return missing ? null : host.trim().toLowerCase()
}

/**
 * The batch's allow-list. `base` is what the container backend would use (the owner's `caps.json` or environment, else the Claude
 * hosts); `explicit` says the owner set it, which makes it the ceiling the computed list is cut to. Returns { allow, why, skipped }.
 */
export function batchEgress({ model, vendor = false, cases = [], packs = [], targets = null, base = [], explicit = false }) {
  const hosts = modelHosts(model)
  const skipped = []
  const plugins = vendor ? [...new Set(cases.flatMap((c) => parseSeedList(parseSeed(c.seed).plugins)))].sort() : []
  const vendorHosts = []
  for (const id of plugins) {
    const pack = packs.find((p) => p.id === id)
    if (!pack) {
      skipped.push(`${id}: no pack`)
      continue
    }
    for (const entry of pack.egress ?? []) {
      const host = fillHost(entry, targets)
      if (host) vendorHosts.push(host)
      else skipped.push(`${id}: ${entry} (the targets file lacks the alias)`)
    }
  }
  // Not credentialed and not a model that needs its own hosts: the backend's list stands, as it always has.
  if (!vendor && !(hosts && model.startsWith("opencode/"))) return { allow: [...base].sort(), why: "the backend's list", plugins: [], skipped }
  let allow = [...new Set([...(hosts ?? base), ...vendorHosts])].sort()
  if (explicit) {
    const ceiling = new Set(base)
    const cut = allow.filter((h) => !ceiling.has(h))
    if (cut.length) skipped.push(`cut to the owner's list: ${cut.join(", ")}`)
    allow = allow.filter((h) => ceiling.has(h))
  }
  return { allow, why: `${model}'s hosts${plugins.length ? ` and the hosts of ${plugins.join(", ")}` : ""}`, plugins, skipped }
}
