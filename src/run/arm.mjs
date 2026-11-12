// The build under test: a plugin's dist, skills, assets and package.json, copied once per batch so a campaign never
// sees a later edit to the checkout. `none` is the no-plugin control.
//
// Provenance is recorded per axis so `evals policy` can name what changed between two arms. A `.provenance.json`
// beside the build (the History lab's variants carry one, with the description, namespace, result-text and rule
// hashes only the plugin's source can give) is used as it is; otherwise the build and the skills are hashed here and
// the other axes stay unrecorded.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { execFileSync } from "node:child_process"
import { sha256 } from "../util/canonical.mjs"

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

/** Copies a built plugin into `into`. Throws when the source is not a built plugin. */
export function materialiseArm(source, into) {
  if (!existsSync(join(source, "package.json"))) throw new Error(`no plugin at ${source}: no package.json`)
  if (!existsSync(join(source, "dist")) || !statSync(join(source, "dist")).isDirectory()) throw new Error(`${source} is not built: no dist/`)
  mkdirSync(into, { recursive: true, mode: 0o700 })
  for (const part of ["dist", "skills", "assets"]) if (existsSync(join(source, part))) cpSync(join(source, part), join(into, part), { recursive: true })
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
  const plugin = treeDigest(join(dir, "dist"))
  const declared = existsSync(join(dir, ".provenance.json")) ? JSON.parse(readFileSync(join(dir, ".provenance.json"), "utf8")) : null
  const commit = git(source, ["rev-parse", "--short=12", "HEAD"])
  const dirty = commit ? Boolean(git(source, ["status", "--porcelain"])) : false
  const provenance = declared ?? {
    plugin,
    plugin_version: pkg.version ?? null,
    plugin_commit: commit ? `${commit}${dirty ? "+dirty" : ""}` : null,
    skills: existsSync(join(dir, "skills")) ? treeDigest(join(dir, "skills")) : sha256("no-skills"),
  }
  return { arm: pkg.name ?? "plugin", sha256: plugin, version: pkg.version ?? null, provenance }
}
