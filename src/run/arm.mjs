// The build under test: a plugin's dist, skills, assets and package.json, copied once per batch so a campaign never
// sees a later edit to the checkout. `none` is the no-plugin control.
//
// Provenance is recorded per axis so `evals policy` can name what changed between two arms. A `.provenance.json`
// beside the build (the History lab's variants carry one, with the description, namespace, result-text and rule
// hashes only the plugin's source can give) is used as it is; otherwise the build and the skills are hashed here and
// the other axes stay unrecorded.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { execFileSync } from "node:child_process"
import { sha256 } from "../util/canonical.mjs"
import { isMemoryPackage, materialiseMemoryArm, memoryArtifact } from "./mem-arm.mjs"

const filesUnder = (dir) => {
  if (!existsSync(dir)) return []
  const out = []
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) out.push(path)
    }
  }
  walk(dir)
  return out
}

/** One digest over a tree: every file's relative path and bytes, in order. */
export const treeDigest = (dir) => sha256(filesUnder(dir).map((file) => `${relative(dir, file)}\u0000${sha256(readFileSync(file))}`).join("\n"))

/**
 * What a plugin needs at run time besides `dist/`: the paths its package.json `files` lists (a plugin's `guest/`, `manifest/`,
 * `native/`, `licenses/`, `views/`, an icon), found by the probes (EVALS-232 P0-A2) after the host reported boxd's missing
 * `guest/guest.py` and gws's missing `manifest/generated.json`. `dist`, `skills`, `assets` and the package file are always
 * copied; a negated entry (`!dist/**.map`) and a path that does not exist are skipped. Never `node_modules`, `.git`, `src` or `test`.
 */
export function runtimePaths(source) {
  const paths = new Set(["dist", "skills", "assets"])
  try {
    const files = JSON.parse(readFileSync(join(source, "package.json"), "utf8")).files
    if (Array.isArray(files)) for (const entry of files) if (typeof entry === "string" && !entry.startsWith("!") && !/[*?{]/.test(entry)) paths.add(entry.replace(/^\.\//, "").replace(/\/$/, ""))
  } catch {
    // an unreadable package.json fails below, with the better message
  }
  return [...paths].filter((path) => !/^(node_modules|\.git|src|test)(\/|$)/.test(path) && !path.startsWith("..") && !path.startsWith("/"))
}

/** Copies a built plugin into `into`. Throws when the source is not a built plugin. */
export function materialiseArm(source, into) {
  if (!existsSync(join(source, "package.json"))) throw new Error(`no plugin at ${source}: no package.json`)
  if (isMemoryPackage(JSON.parse(readFileSync(join(source, "package.json"), "utf8")))) return materialiseMemoryArm(source, into)
  if (!existsSync(join(source, "dist")) || !statSync(join(source, "dist")).isDirectory()) throw new Error(`${source} is not built: no dist/`)
  mkdirSync(into, { recursive: true, mode: 0o700 })
  for (const part of runtimePaths(source)) {
    const from = join(source, part)
    if (!existsSync(from)) continue
    mkdirSync(dirname(join(into, part)), { recursive: true })
    cpSync(from, join(into, part), { recursive: true })
  }
  for (const file of ["package.json", ".provenance.json"]) if (existsSync(join(source, file))) cpSync(join(source, file), join(into, file))
  return into
}

const git = (dir, args) => {
  try {
    return execFileSync("git", ["-C", dir, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()
  } catch {
    return null
  }
}

/** The arm's provenance: recorded hashes per axis, and the digest the world's build is stamped with. */
export function armProvenance(dir, source = dir) {
  if (!dir) return { arm: "none", sha256: null, provenance: { arm: "none" } }
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
  const memory = isMemoryPackage(pkg) ? memoryArtifact(dir) : null
  const plugin = memory ? memory.closure_sha256 : treeDigest(join(dir, "dist"))
  const declared = existsSync(join(dir, ".provenance.json")) ? JSON.parse(readFileSync(join(dir, ".provenance.json"), "utf8")) : null
  const commit = memory ? null : git(source, ["rev-parse", "--short=12", "HEAD"])
  const dirty = commit ? Boolean(git(source, ["status", "--porcelain"])) : false
  const provenance = memory ? { plugin, plugin_version: pkg.version, plugin_commit: memory.source_commit, archive_sha256: memory.archive_sha256, packaging: "oc-mem-arm/1", skills: treeDigest(join(dir, "skills")) } : declared ?? {
    plugin,
    plugin_version: pkg.version ?? null,
    plugin_commit: commit ? `${commit}${dirty ? "+dirty" : ""}` : null,
    skills: existsSync(join(dir, "skills")) ? treeDigest(join(dir, "skills")) : sha256("no-skills"),
  }
  return { arm: pkg.name ?? "plugin", sha256: plugin, version: pkg.version ?? null, provenance }
}

/**
 * Companions (R1): the other plugins installed beside the arm, as they are on the owner's machine. An arm file names
 * them as a map from the plugin id to a built directory, or to `{ package, options }`, or as the path (relative to the
 * arm file) of a JSON file holding that map (`companions-r1.json`):
 *
 *   { "package": "../opencode-slack", "options": { "access": "ask-changes" },
 *     "companions": "companions-r1.json" }
 *
 * The arm's own id is dropped from the list (it is the arm). Returns [{ id, dir, source, version }], sorted by id. A
 * companion's `options.access` is not the arm file's to choose: lockdown.mjs sets it (ask-changes) and its caps.
 */
export function readCompanions(spec, { base, exclude = [] } = {}) {
  if (spec === undefined || spec === null || spec === false) return []
  let map = spec
  if (typeof spec === "string") {
    const file = resolve(base ?? ".", spec)
    if (!existsSync(file)) throw new Error(`companions file ${file} does not exist`)
    map = JSON.parse(readFileSync(file, "utf8"))
    base = dirname(file)
  }
  if (Array.isArray(map) || !map || typeof map !== "object") throw new Error('"companions" is a map from a plugin id to a built directory, or the path of a file holding one')
  const out = []
  for (const [id, value] of Object.entries(map)) {
    if (id.startsWith("_") || exclude.includes(id)) continue
    if (!/^[a-z][a-z0-9-]*$/.test(id)) throw new Error(`companion id ${JSON.stringify(id)} must be a plugin id`)
    const source = typeof value === "string" ? value : value?.package
    if (typeof source !== "string" || !source) throw new Error(`companion ${id} names no built directory`)
    out.push({ id, source: resolve(base ?? ".", source), extra: typeof value === "object" && value?.options ? value.options : {} })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id))
}

/** Copies each companion's build into `<into>/<id>`, and records what it is (version, digest of its dist). */
export function materialiseCompanions(companions, into, { options = (id, extra) => extra } = {}) {
  mkdirSync(into, { recursive: true, mode: 0o700 })
  return companions.map((companion) => {
    const dir = materialiseArm(companion.source, join(into, companion.id))
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
    return { id: companion.id, dir, source: companion.source, version: pkg.version ?? null, sha256: treeDigest(join(dir, "dist")), options: options(companion.id, companion.extra ?? {}) }
  })
}

/** The provenance axis `companions`: which plugins sat beside the arm, at which build. */
export const companionsDigest = (materialised) => (materialised.length ? sha256(materialised.map((c) => `${c.id}@${c.version}:${c.sha256}`).join("\n")) : sha256("no-companions"))
