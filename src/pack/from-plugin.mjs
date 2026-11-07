// A pack is derived from the plugin's own declaration, never typed by hand: `jelly.tools` already names
// every tool, its permission action and its effect, and `jelly.skills` names the skills. What the
// declaration does not carry (the RPC id, the fake, the T1 cases) comes from `packs/<id>/pack.json`.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

export const PLUGIN_ROOT = (id) => {
  const root = process.env.EVALS_PLUGIN_ROOT ?? process.env.HOME ?? ""
  return join(root, `opencode-${id}`)
}

const classOf = (tool) => (tool.effect === "deny" ? "destructive" : tool.readOnly ? "read" : "write")

/** Reads one plugin checkout and returns the derived half of its pack. */
export function derivePack(id, directory) {
  const dir = directory ?? PLUGIN_ROOT(id)
  const pkgFile = join(dir, "package.json")
  if (!existsSync(pkgFile)) throw new Error(`no plugin at ${dir} (set EVALS_PLUGIN_ROOT)`)
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"))
  const jelly = pkg.jelly ?? {}
  const constants = existsSync(join(dir, "src/constants.ts")) ? readFileSync(join(dir, "src/constants.ts"), "utf8") : ""
  const pluginId = (constants.match(/PLUGIN_ID\s*=\s*"([^"]+)"/) ?? [])[1] ?? null
  const tools = (jelly.tools ?? []).map((tool) => ({
    name: String(tool.name ?? "").replace(/^[a-z]+[._]/, ""),
    permission: tool.permission ?? String(tool.name ?? "").replace(".", "_"),
    effect: tool.effect ?? "allow",
    readOnly: Boolean(tool.readOnly),
    class: classOf(tool),
  }))
  return {
    id,
    name: jelly.title ?? id,
    package: pkg.name ?? null,
    version: pkg.version ?? null,
    private: Boolean(pkg.private),
    pluginId,
    skills: (jelly.skills ?? []).map(String),
    tools,
    counts: {
      tools: tools.length,
      reads: tools.filter((t) => t.class === "read").length,
      writes: tools.filter((t) => t.class === "write").length,
      denied: tools.filter((t) => t.effect === "deny").length,
      skills: (jelly.skills ?? []).length,
    },
  }
}

/** The declared half: what the declaration cannot carry. Committed, small, and reviewed. */
export function readPack(id, root = join(import.meta.dirname, "..", "..")) {
  const file = join(root, "packs", id, "pack.json")
  const declared = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  const derived = derivePack(id)
  return {
    ...derived,
    ...declared,
    tools: derived.tools,
    counts: { ...derived.counts, ...(declared.counts ?? {}) },
  }
}

export function writePack(id, root = join(import.meta.dirname, "..", "..")) {
  const file = join(root, "packs", id, "pack.json")
  const declared = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}
  const pack = { ...declared, ...derivePack(id) }
  mkdirSync(join(root, "packs", id), { recursive: true })
  writeFileSync(file, `${JSON.stringify(pack, null, 2)}\n`)
  return pack
}
