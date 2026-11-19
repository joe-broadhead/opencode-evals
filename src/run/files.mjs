// The files a run wrote: the working directory before and after, compared by digest. Kept beside the recording
// (`<case>.t<k>.files.json`, private like it) so a case can grade a script or a note the agent wrote; never traced.

import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"
import { sha256 } from "../util/canonical.mjs"

const TEXT_LIMIT = 64 * 1024

/** Every file under `dir` (the .git directory aside), by relative path, with its digest. */
export function snapshotFiles(dir) {
  const out = new Map()
  if (!existsSync(dir)) return out
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      if (entry.name === ".git") continue
      const path = join(at, entry.name)
      if (entry.isDirectory()) walk(path)
      else if (entry.isFile()) out.set(relative(dir, path), { sha256: sha256(readFileSync(path)), bytes: statSync(path).size })
    }
  }
  walk(dir)
  return out
}

/** What changed: added, modified and deleted files, with a small text file's content for the grader. */
export function changedFiles(before, dir) {
  const after = snapshotFiles(dir)
  const changes = []
  for (const [path, file] of after) {
    const old = before.get(path)
    if (old && old.sha256 === file.sha256) continue
    const body = file.bytes <= TEXT_LIMIT ? readFileSync(join(dir, path)) : null
    const text = body && !body.includes(0) ? body.toString("utf8") : null
    changes.push({ path, change: old ? "modified" : "added", sha256: file.sha256, bytes: file.bytes, ...(text !== null ? { text } : {}) })
  }
  for (const [path, file] of before) if (!after.has(path)) changes.push({ path, change: "deleted", sha256: file.sha256, bytes: file.bytes })
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Files a run wrote outside its project, in named places under its HOME (`plaud_export` writes to ~/Plaud). Only the paths a case
 * names are recorded (`Home files: Plaud`), so nothing else of the home reaches a record; each is labelled `~/<name>/<path>`, which
 * a `file:~/Plaud/**` clause matches. Same digests and the same small-text rule as the project's.
 */
export function snapshotHome(home, names = []) {
  const out = new Map()
  for (const name of names) {
    const base = join(home, name)
    // A link is never followed: a trial with a shell could aim `~/Plaud` at a path of the host and have its contents recorded.
    if (homeLinks(home, [name]).length) continue
    for (const [rel, file] of snapshotFiles(base)) out.set(`~/${name}/${rel}`, file)
    if (existsSync(base) && lstatSync(base).isFile()) out.set(`~/${name}`, { sha256: sha256(readFileSync(base)), bytes: statSync(base).size })
  }
  return out
}

/** The named places that are symbolic links (or lie behind one): refused, never read. */
export function homeLinks(home, names = []) {
  const found = []
  for (const name of names) {
    let at = home
    for (const part of name.split("/")) {
      at = join(at, part)
      try {
        if (lstatSync(at).isSymbolicLink()) {
          found.push(name)
          break
        }
      } catch {
        break
      }
    }
  }
  return found
}

export function changedHome(before, home, names = []) {
  const after = snapshotHome(home, names)
  const changes = []
  const read = (label) => join(home, label.slice(2))
  for (const [path, file] of after) {
    const old = before.get(path)
    if (old && old.sha256 === file.sha256) continue
    const body = file.bytes <= TEXT_LIMIT ? readFileSync(read(path)) : null
    const text = body && !body.includes(0) ? body.toString("utf8") : null
    changes.push({ path, change: old ? "modified" : "added", sha256: file.sha256, bytes: file.bytes, ...(text !== null ? { text } : {}) })
  }
  for (const [path, file] of before) if (!after.has(path)) changes.push({ path, change: "deleted", sha256: file.sha256, bytes: file.bytes })
  return changes.sort((a, b) => a.path.localeCompare(b.path))
}
