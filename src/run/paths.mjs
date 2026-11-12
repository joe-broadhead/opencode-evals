// Names that become path segments, and the roots a runner may write or delete under. A case id, an iteration, a
// plugin id or a world key is a single segment: letters, digits, dot, dash and underscore, starting with a letter or
// digit, never `..`. Every path the runner writes or removes is checked to resolve inside the root it belongs to.

import { resolve, sep } from "node:path"

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function isSegment(value) {
  return typeof value === "string" && SEGMENT.test(value) && !value.includes("..") && value.length <= 200
}

/** Throws unless `value` is one safe path segment. */
export function segment(kind, value) {
  if (!isSegment(value)) throw new Error(`${kind} ${JSON.stringify(value)} is not a safe name: letters, digits, dot, dash, underscore, no ".."`)
  return value
}

/** Is `path` the root itself or under it, once both are resolved? */
export const inside = (root, path) => {
  const base = resolve(root)
  const target = resolve(path)
  return target === base || target.startsWith(base.endsWith(sep) ? base : `${base}${sep}`)
}

/** Throws unless `path` resolves inside `root`; returns the resolved path. */
export function within(root, path, what = "path") {
  if (!inside(root, path)) throw new Error(`refusing to touch ${what} ${resolve(path)}: it is outside ${resolve(root)}`)
  return resolve(path)
}
