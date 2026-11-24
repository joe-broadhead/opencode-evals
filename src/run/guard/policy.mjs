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
 * The policy: `mode` "refuse" (no write passes), "commit" (only `commit[<permission>] = { extract, allow }` passes, and a plan
 * commit only for a plan made in scope: `plans`) or "log" (also blocks writes). `packs` defaults to every pack here.
 */
export function buildPolicy({ mode = "refuse", packs = loadPacks(), commit = {}, plans = null, locked = false } = {}) {
  const writes = []
  const actions = new Set()
  const inventory = { reads: [], writes: [] }
  for (const pack of packs) {
    for (const tool of pack.tools ?? []) {
      if (!["read", "write"].includes(tool.class)) throw new Error(`unclassified pack tool: ${pack.id}.${tool.name}`)
      inventory[tool.class === "read" ? "reads" : "writes"].push({ action: tool.permission, names: namesOf(pack, tool) })
      if (tool.class !== "write") continue
      actions.add(tool.permission)
      const declared = commit[tool.permission]
      writes.push({ names: namesOf(pack, tool), action: tool.permission, ...(declared ? { ...(declared.extract ? { extract: declared.extract } : {}), ...(declared.allow ? { allow: declared.allow } : {}), ...(declared.local === true ? { local: true } : {}) } : {}) })
    }
  }
  // A commit set may name an action no pack lists (a tool the plugin registers that its pack lacks): it is then a write the plan declares, so the guard treats it like one.
  for (const [action, declared] of Object.entries(commit)) {
    if (actions.has(action)) continue
    actions.add(action)
    const dotted = action.replace("_", ".")
    writes.push({ names: [...new Set([action, dotted])].sort(), action, ...(declared.extract ? { extract: declared.extract } : {}), ...(declared.allow ? { allow: declared.allow } : {}), ...(declared.local === true ? { local: true } : {}) })
    inventory.writes.push({ action, names: [...new Set([action, dotted])].sort() })
  }
  // A locked trial calls only `execute`, `skill`, `question`, `todowrite` and the tools of the plugins installed (their ids, namespaces and
  // RPC names, and the eval-only probe's): anything else is refused at execute.before and logged (G0 review 3.1).
  const prefixes = new Set(["evalsprobe"])
  for (const pack of packs) for (const prefix of [pack.id, String(pack.pluginId ?? "").split(".")[0], String(pack.rpc ?? "").split(".")[0]]) if (prefix) prefixes.add(prefix)
  // Every tool of every pack, of any class, by every name it can reach the guard under: in a locked trial a call of a plugin's prefix that is not here is a tool no pack lists, and is a write
  // (fail closed: an unclassified tool is the one that places a call or spends credits; review of #14, round 3).
  const known = new Set()
  for (const pack of packs) for (const tool of pack.tools ?? []) for (const name of namesOf(pack, tool)) known.add(name)
  for (const write of writes) for (const name of write.names) known.add(name)
  return { mode, writes, actions: [...actions].sort(), known: [...known].sort(), inventory, ...(plans ? { plans } : {}), ...(locked ? { tools: { exact: ["execute", "skill", "question", "todowrite"], prefixes: [...prefixes].sort() } } : {}) }
}

/** Copies the guard into `into/guard` and writes its policy read-only beside it. Returns the guard's directory. */
export function installGuard(into, policy) {
  const dir = join(into, "guard")
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  for (const file of ["index.ts", "plugin.ts", "logic.mjs", "package.json"]) cpSync(join(GUARD_SOURCE, file), join(dir, file))
  const { inventory, ...rules } = policy
  writeFileSync(join(dir, "inventory.json"), `${JSON.stringify(inventory, null, 1)}\n`, { mode: 0o444 })
  writeFileSync(join(dir, "guard.json"), `${JSON.stringify(rules, null, 1)}\n`, { mode: 0o444 })
  return dir
}
