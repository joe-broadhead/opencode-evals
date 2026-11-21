// Names that become path segments, and the roots a runner may write or delete under. A case id, an iteration, a
// plugin id or a world key is a single segment: letters, digits, dot, dash and underscore, starting with a letter or
// digit, never `..`. Every path the runner writes or removes is checked to resolve inside the root it belongs to.

import { lstatSync, readlinkSync } from "node:fs"
import { dirname, join, resolve, sep, isAbsolute } from "node:path"

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isSegment(value) {
  return typeof value === "string" && SEGMENT.test(value) && !value.includes("..") && value.length <= 200
}

/** Throws unless `value` is one safe path segment. */
export function segment(kind, value) {
  if (!isSegment(value)) throw new Error(`${kind} ${JSON.stringify(value)} is not a safe name: letters, digits, dot, dash, underscore, no ".."`)
  return value
}

/** Never inside any root: what a link loop, or a chain too long to follow, resolves to. */
const NOWHERE = "/\u0000unresolvable"

/**
 * A path with every symlink resolved the way the kernel resolves it, component by component: a link's target is followed
 * before the next component is applied, so a `..` after a link is evaluated where the link points, not lexically. This
 * holds for a target that does not exist yet too: `hop -> ../..` then `x -> hop/../../../PLANTED` resolves outside the
 * root even though `PLANTED` is missing. A link loop, or a chain too long to follow, resolves to NOWHERE.
 */
export function real(path, depth = 0) {
  if (depth > 40) return NOWHERE
  let current = sep
  for (const part of (isAbsolute(path) ? String(path) : resolve(path)).split(sep)) {
    if (part === "" || part === ".") continue
    if (part === "..") {
      current = dirname(current)
      continue
    }
    const next = join(current, part)
    let stat
    try {
      stat = lstatSync(next)
    } catch {
      // Missing: nothing below it can exist, and no link can be crossed after this point.
      current = next
      continue
    }
    if (!stat.isSymbolicLink()) {
      current = next
      continue
    }
    let target
    try {
      target = readlinkSync(next)
    } catch {
      return NOWHERE
    }
    const resolved = real(target.startsWith(sep) ? target : `${current}${sep}${target}`, depth + 1)
    if (resolved === NOWHERE) return NOWHERE
    current = resolved
  }
  return current
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
