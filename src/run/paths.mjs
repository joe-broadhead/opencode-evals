// Names that become path segments, and the roots a runner may write or delete under. A case id, an iteration, a
// plugin id or a world key is a single segment: letters, digits, dot, dash and underscore, starting with a letter or
// digit, never `..`. Every path the runner writes or removes is checked to resolve inside the root it belongs to.

import { lstatSync, readlinkSync, realpathSync } from "node:fs"
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

/** Never inside any root: what a link loop, a chain too long to follow, or a spent budget resolves to. */
const NOWHERE = "/\u0000unresolvable"

/** The kernel's limit: at most 40 symlink traversals for one path lookup, then ELOOP. */
export const LINK_BUDGET = 40

/**
 * A path with every symlink resolved the way the kernel resolves it. An existing path is the kernel's to resolve
 * (`realpathSync.native`), which enforces ELOOP at LINK_BUDGET follows and is what makes a link explosion cheap. A path
 * with a missing tail, or a dangling link, is walked component by component: a link's target is followed before the
 * next component is applied, so a `..` after a link is evaluated where the link points, not lexically, and a target that
 * does not exist yet is carried along. Every follow in that walk comes out of ONE shared budget for the whole resolution
 * (the kernel's 40); a spent budget and a link loop both resolve to NOWHERE, which callers treat as outside (fail
 * closed). `budget` is shared by the recursion and may be passed in to observe `followed`.
 */
export function real(path, budget = { left: LINK_BUDGET, followed: 0 }) {
  const absolute = isAbsolute(path) ? String(path) : resolve(path)
  try {
    return realpathSync.native(absolute)
  } catch (error) {
    if (error.code === "ELOOP") return NOWHERE
    // ENOENT or ENOTDIR: nothing at the end yet. Resolve what exists below, following links itself, within the budget.
  }
  return walk(absolute, budget)
}

/** The component-wise half of `real()`: only a path the kernel could not resolve whole. */
function walk(path, budget) {
  let current = sep
  for (const part of path.split(sep)) {
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
    if (budget.left <= 0) return NOWHERE
    budget.left--
    budget.followed++
    let target
    try {
      target = readlinkSync(next)
    } catch {
      return NOWHERE
    }
    const resolved = walk(target.startsWith(sep) ? target : `${current}${sep}${target}`, budget)
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
