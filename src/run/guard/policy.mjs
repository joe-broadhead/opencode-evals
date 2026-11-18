// The guard's policy file (guard.json): every write tool of every pack, by every name it can reach `execute.before` under.
// Built by the runner, written read-only into the batch's own copy of the guard, never read from a case or a world.

import { cpSync, mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { loadPacks } from "../lockdown.mjs"

export const GUARD_SOURCE = resolve(import.meta.dirname)

/**
 * The names one pack tool can be seen under: namespaced by the plugin id or its RPC namespace, and its permission action.
 * A bare name is included only when it already starts with the plugin's prefix (`slack_send_message`): a generic one
 * (`write`, `execute`, `send`) would also match the host's own tools and other plugins' reads.
 */
export function namesOf(pack, tool) {
  const ns = String(pack.pluginId ?? pack.id).split(".")[0]
  const rpc = String(pack.rpc ?? "").split(".")[0]
  const prefixes = [pack.id, ns, rpc].filter(Boolean)
  const set = new Set([tool.permission])
  if (tool.permission?.includes(".")) set.add(tool.permission.replace(".", "_"))
  for (const prefix of prefixes) {
    set.add(`${prefix}_${tool.name}`)
    set.add(`${prefix}.${tool.name}`)
    if (tool.name.startsWith(`${prefix}_`)) set.add(tool.name)
  }
  return [...set].filter(Boolean).sort()
}

/**
 * The policy: `mode` "refuse" (no write passes), "commit" (only `commit[<permission>] = { extract, allow }` passes) or
 * "log" (probes: observe only). `packs` defaults to every pack in this repository.
 */
export function buildPolicy({ mode = "refuse", packs = loadPacks(), commit = {} } = {}) {
  const writes = []
  const actions = new Set()
  for (const pack of packs) {
    for (const tool of pack.tools ?? []) {
      if (tool.class !== "write") continue
      actions.add(tool.permission)
      const declared = commit[tool.permission]
      writes.push({ names: namesOf(pack, tool), action: tool.permission, ...(declared ? { extract: declared.extract, allow: declared.allow } : {}) })
    }
  }
  return { mode, writes, actions: [...actions].sort() }
}

/** Copies the guard into `into/guard` and writes its policy read-only beside it. Returns the guard's directory. */
export function installGuard(into, policy) {
  const dir = join(into, "guard")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const file of ["index.ts", "plugin.ts", "package.json"]) cpSync(join(GUARD_SOURCE, file), join(dir, file))
  writeFileSync(join(dir, "guard.json"), `${JSON.stringify(policy, null, 1)}\n`, { mode: 0o444 })
  return dir
}
