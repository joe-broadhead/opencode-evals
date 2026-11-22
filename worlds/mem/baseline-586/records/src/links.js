/**
 * Links: `[[target]]`, `[[target|label]]` and `[[target#heading]]` in a body,
 * plus `fields.links`. A target is a page path or a record id. Edges are
 * written on every save, so backlinks are an index lookup (contract §2.3).
 */
import { RECORD_ID } from "./ids.js"

export const PATH = /^[a-z0-9][a-z0-9-]{0,63}(?:\/[a-z0-9][a-z0-9-]{0,63}){0,3}$/

// [[target]], [[target|label]], [[target#heading]], [[target#heading|label]]
const WIKILINK = /\[\[([^\[\]|#\n]+)(#[^\[\]|\n]*)?(\|[^\[\]\n]*)?\]\]/g

/**
 * The canonical form of a link target, or null when it is neither a path nor a
 * record id. Obsidian habits are forgiven: a leading "/", a ".md" suffix,
 * capitals, and `memories/<id>` (the export's file for a memory).
 */
export function normalizeTarget(raw) {
  let value = String(raw ?? "").trim()
  if (!value) return null
  const upper = value.replace(/^\/+/, "").replace(/\.md$/i, "")
  const id = upper.replace(/^memories\//i, "")
  if (/^rec_/i.test(id)) {
    const canonical = `rec_${id.slice(4).toUpperCase()}`
    return RECORD_ID.test(canonical) ? canonical : null
  }
  value = upper.toLowerCase()
  return PATH.test(value) ? value : null
}

/** Every distinct link target in a body and a `fields.links` list, in order of appearance. */
export function deriveLinks(body, fieldLinks) {
  const seen = new Set()
  for (const match of String(body ?? "").matchAll(WIKILINK)) {
    const target = normalizeTarget(match[1])
    if (target) seen.add(target)
  }
  if (Array.isArray(fieldLinks)) {
    for (const raw of fieldLinks) {
      const target = normalizeTarget(raw)
      if (target) seen.add(target)
    }
  }
  return [...seen]
}

/**
 * Rewrite every link to `from` in a body so it points at `to`, keeping any
 * heading and label. Returns the new body and how many links changed.
 */
export function rewriteBody(body, from, to) {
  let count = 0
  const text = String(body ?? "").replace(WIKILINK, (whole, target, heading, label) => {
    if (normalizeTarget(target) !== from) return whole
    count += 1
    return `[[${to}${heading ?? ""}${label ?? ""}]]`
  })
  return { text, count }
}

/**
 * Rewrite every link whose target is a key of `map` (old path → new path) in
 * one pass, so a folder move never rewrites a link twice.
 */
export function rewriteBodyMap(body, map) {
  let count = 0
  const text = String(body ?? "").replace(WIKILINK, (whole, target, heading, label) => {
    const to = map.get(normalizeTarget(target))
    if (!to) return whole
    count += 1
    return `[[${to}${heading ?? ""}${label ?? ""}]]`
  })
  return { text, count }
}

/** `rewriteFieldLinks` over a map of old path → new path; null when nothing changed. */
export function rewriteFieldLinksMap(list, map) {
  if (!Array.isArray(list)) return null
  let changed = false
  const next = list.map((raw) => {
    const to = map.get(normalizeTarget(raw))
    if (!to) return raw
    changed = true
    return to
  })
  return changed ? next : null
}

/** Rewrite a `fields.links` list; returns null when nothing changed. */
export function rewriteFieldLinks(list, from, to) {
  if (!Array.isArray(list)) return null
  let changed = false
  const next = list.map((raw) => {
    if (normalizeTarget(raw) !== from) return raw
    changed = true
    return to
  })
  return changed ? next : null
}
