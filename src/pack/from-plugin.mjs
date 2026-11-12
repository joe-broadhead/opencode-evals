// The derived half of a pack: what a plugin's own `jelly` declaration says. This module only ever reads a
// checkout, and a checkout is wherever configuration says it is — never a guessed directory.

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { sha256 } from "../util/canonical.mjs"
import { PACK_SCHEMA, packDigest, recomputeCounts, writeSnapshot, snapshotChecks } from "./snapshot.mjs"

/**
 * Where one plugin's checkout is, or null. `EVALS_REPO_<ID>` names one plugin; `EVALS_PLUGIN_ROOT`
 * names a directory holding `opencode-<id>` checkouts. No default: a missing checkout is `null`, and the
 * snapshot is what the tool uses.
 */
export function pluginRepo(id, env = process.env) {
  const perPlugin = env[`EVALS_REPO_${id.toUpperCase()}`]
  if (perPlugin) return perPlugin
  const root = env.EVALS_PLUGIN_ROOT
  return root ? join(root, `opencode-${id}`) : null
}

export function repoAvailable(id, env = process.env) {
  const dir = pluginRepo(id, env)
  return Boolean(dir && existsSync(join(dir, "package.json")))
}

const classOf = (tool) => (tool.effect === "deny" ? "destructive" : tool.readOnly ? "read" : "write")

/** The frontmatter of one skill file, as a digest plus a size — never the body. */
function skillMeta(dir) {
  const file = join(dir, "SKILL.md")
  if (!existsSync(file)) return null
  const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n")
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text)
  if (!match) return null
  const fields = {}
  for (const line of match[1].split("\n")) {
    const at = line.indexOf(":")
    if (at < 0) continue
    fields[line.slice(0, at).trim()] = line.slice(at + 1).trim().replace(/^["'](.*)["']$/, "$1")
  }
  return {
    name: fields.name ?? null,
    description_sha256: sha256(fields.description ?? ""),
    description_chars: (fields.description ?? "").length,
    body_lines: match[2].split("\n").length,
  }
}

/** Reads one plugin checkout and returns the derived half of its pack. Throws when there is no checkout. */
export function derivePack(id, directory = pluginRepo(id)) {
  if (!directory) throw new Error(`no checkout for ${id}: set EVALS_REPO_${id.toUpperCase()} or EVALS_PLUGIN_ROOT`)
  const pkgFile = join(directory, "package.json")
  if (!existsSync(pkgFile)) throw new Error(`no plugin at ${directory}`)
  const pkg = JSON.parse(readFileSync(pkgFile, "utf8"))
  const jelly = pkg.jelly ?? {}
  // The plugin id lives in `src/constants.ts` in most repos and elsewhere in a few; read the source tree
  // rather than guess a file name.
  let source = ""
  const walk = (dir, depth = 0) => {
    if (depth > 3 || !existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) walk(path, depth + 1)
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) source += readFileSync(path, "utf8")
    }
  }
  walk(join(directory, "src"))
  const pluginId = (source.match(/PLUGIN_ID\s*=\s*"([^"]+)"/) ?? [])[1] ?? null
  const tools = (jelly.tools ?? []).map((tool) => ({
    name: String(tool.name ?? "").replace(/^[a-z]+[._]/, ""),
    permission: tool.permission ?? String(tool.name ?? "").replace(".", "_"),
    effect: tool.effect ?? "allow",
    readOnly: Boolean(tool.readOnly),
    class: classOf(tool),
  }))
  // The family's one access option: `all` (the default) allows every tool, `ask-changes` asks for the changes,
  // `read-only` denies them. The tools' declared effects are the default's; the option is recorded beside them.
  const accessSetting = (jelly.contributes?.settings ?? []).find((setting) => setting?.key === "access")
  const access = accessSetting ? { key: "access", default: accessSetting.default ?? null } : null
  const skills = (jelly.skills ?? []).map(String)
  const skill_meta = {}
  for (const name of skills) {
    const meta = skillMeta(join(directory, "skills", name))
    if (meta) skill_meta[name] = meta
  }
  const pack = {
    schema: PACK_SCHEMA,
    id,
    name: jelly.title ?? id,
    package: pkg.name ?? null,
    version: pkg.version ?? null,
    private: Boolean(pkg.private),
    pluginId,
    rpc: `${pluginId ?? id}.tools`,
    skills,
    skill_meta,
    tools,
    ...(access ? { access } : {}),
    counts: recomputeCounts({ tools, skills }),
  }
  return { ...pack, digest: packDigest(pack) }
}

/** The committed snapshot, or null when the repository does not carry one. */
export function readSnapshot(id, root) {
  const file = join(root, "packs", id, "pack.json")
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null
}

/**
 * The pack a caller should use: the committed snapshot, with the live declaration attached when a checkout
 * is configured, and the drift between them.
 */
export function readPack(id, root = join(import.meta.dirname, "..", ".."), env = process.env) {
  const snapshot = readSnapshot(id, root)
  const live = repoAvailable(id, env) ? derivePack(id, pluginRepo(id, env)) : null
  const base = snapshot ?? live
  if (!base) throw new Error(`no snapshot for ${id} in ${join(root, "packs", id)} and no checkout configured`)
  return { ...base, ...(live ? { live } : {}) }
}

/**
 * Derives from the checkout and writes the snapshot. Requires a checkout by definition.
 *
 * What the checkout can answer wins; what it cannot (the RPC id when a plugin declares it elsewhere, the
 * options a test host needs, the scripted cases) is carried over from the snapshot it replaces. Nothing is
 * dropped silently: `derivePack` says what it knows, and the file keeps the rest.
 */
export function writePack(id, root = join(import.meta.dirname, "..", ".."), env = process.env) {
  const declared = readSnapshot(id, root) ?? {}
  const live = derivePack(id, pluginRepo(id, env))
  const merged = {
    ...declared,
    ...live,
    pluginId: live.pluginId ?? declared.pluginId ?? null,
    rpc: declared.rpc ?? live.rpc,
    t1: declared.t1 ?? live.t1 ?? [],
    tools: live.tools,
    skills: live.skills,
    skill_meta: live.skill_meta,
    counts: live.counts,
    ...(live.access ? { access: live.access } : {}),
    ...(declared.options ? { options: declared.options } : {}),
    ...(declared.fake ? { fake: declared.fake } : {}),
    ...(declared.fakeModuleEnv ? { fakeModuleEnv: declared.fakeModuleEnv } : {}),
    ...(declared.statusRpc ? { statusRpc: declared.statusRpc } : {}),
    ...(declared.vocab ? { vocab: declared.vocab } : {}),
  }
  return writeSnapshot(root, merged)
}

export const packIds = (root) =>
  existsSync(join(root, "packs")) ? readdirSync(join(root, "packs")).filter((name) => existsSync(join(root, "packs", name, "pack.json"))).sort() : []

/**
 * The plugin checkouts configuration points at: every `opencode-<id>` under EVALS_PLUGIN_ROOT, and every
 * EVALS_REPO_<ID>, whose package.json declares tools in its `jelly` section. Nothing is assumed about which plugins
 * exist: a new checkout is found, and one that declares no tools (a library, the harness itself) is not a plugin.
 */
export function discoverPlugins(env = process.env) {
  const found = new Map()
  const consider = (id, dir) => {
    const file = join(dir, "package.json")
    if (!existsSync(file)) return
    try {
      const tools = JSON.parse(readFileSync(file, "utf8")).jelly?.tools
      if (Array.isArray(tools) && tools.length) found.set(id, dir)
    } catch {
      // not a readable package.json: not a plugin
    }
  }
  const root = env.EVALS_PLUGIN_ROOT
  if (root && existsSync(root)) {
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const match = /^opencode-([a-z0-9-]+)$/.exec(entry.name)
      if (match && entry.isDirectory()) consider(match[1], join(root, entry.name))
    }
  }
  for (const [key, dir] of Object.entries(env)) {
    const match = /^EVALS_REPO_([A-Z0-9_]+)$/.exec(key)
    if (match && dir) consider(match[1].toLowerCase().replaceAll("_", "-"), dir)
  }
  return [...found.keys()].sort()
}

/**
 * Whether a checkout's derived declaration can be a pack: the family's invariants that need nothing but the
 * declaration (an id, one permission action per tool, ...). The checks about the declared half, and the digest a write recomputes, are left out.
 */
export function familyProblems(pack) {
  return snapshotChecks({ ...pack, rpc: pack.rpc ?? `${pack.pluginId}.tools`, t1: [] })
    .filter((check) => !check.ok && !["P-06", "P-08", "P-09"].includes(check.id))
    .map((check) => `${check.id} ${check.name}: ${check.detail}`)
}

/** Every pack id there is: the committed snapshots and the configured checkouts. */
export const allPackIds = (root, env = process.env) => [...new Set([...packIds(root), ...discoverPlugins(env)])].sort()
