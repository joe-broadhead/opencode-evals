// Names that become path segments, and the roots a runner may write or delete under. A case id, an iteration, a
// plugin id or a world key is a single segment: letters, digits, dot, dash and underscore, starting with a letter or
// digit, never `..`. Every path the runner writes or removes is checked to resolve inside the root it belongs to.

import { lstatSync, readlinkSync, realpathSync } from "node:fs"
import { dirname, basename, join, resolve, sep } from "node:path"

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isSegment(value) {
  return typeof value === "string" && SEGMENT.test(value) && !value.includes("..") && value.length <= 200
}

/** Throws unless `value` is one safe path segment. */
export function segment(kind, value) {
  if (!isSegment(value)) throw new Error(`${kind} ${JSON.stringify(value)} is not a safe name: letters, digits, dot, dash, underscore, no ".."`)
  return value
}

/** Does anything exist at `path`, a dangling link included? (`existsSync` follows links, so it says no to one.) */
const present = (path) => {
  try {
    lstatSync(path)
    return true
  } catch {
    return false
  }
}

/** Never inside any root: what a link loop, or a chain too long to follow, resolves to. */
const NOWHERE = "/\u0000unresolvable"

/**
 * A path with every symlink in its longest existing prefix resolved: a link inside a root that points out of it, or a
 * root reached through a link, is compared by where it really is. A dangling link is followed to where it points, so
 * it counts as inside only when its target would be. The part that does not exist yet is appended as is.
 */
export function real(path, depth = 0) {
  if (depth > 40) return NOWHERE
  let head = resolve(path)
  const tail = []
  while (!present(head)) {
    const parent = dirname(head)
    if (parent === head) break
    tail.unshift(basename(head))
    head = parent
  }
  let resolved
  try {
    resolved = realpathSync(head)
  } catch {
    // It exists but does not resolve: a dangling link (or a loop). Follow the link itself, from where it sits.
    let stat = null
    try {
      stat = lstatSync(head)
    } catch {
      // gone meanwhile
    }
    if (stat?.isSymbolicLink()) {
      let target
      try {
        target = readlinkSync(head)
      } catch {
        return NOWHERE
      }
      const parent = (() => {
        try {
          return realpathSync(dirname(head))
        } catch {
          return dirname(head)
        }
      })()
      resolved = real(resolve(parent, target), depth + 1)
      if (resolved === NOWHERE) return NOWHERE
    } else resolved = head
  }
  return tail.length ? join(resolved, ...tail) : resolved
}

/** Is `path` the root itself or under it, once both are resolved, symlinks included? */
export const inside = (root, path) => {
  const base = real(root)
  const target = real(path)
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
}

/** Throws unless `path` resolves inside `root`; returns the resolved path. */
export function within(root, path, what = "path") {
  if (!inside(root, path)) throw new Error(`refusing to touch ${what} ${resolve(path)}: it is outside ${resolve(root)}`)
  return resolve(path)
}
