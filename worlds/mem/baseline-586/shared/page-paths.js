/**
 * A page's path, in one place (docs/design/memory-v1-contracts.md §2.3).
 *
 * The plugin's operations (`src/ops/space-ops.js`) and Memory's console
 * (`deploy/auth/console/pages.mjs`) both write pages through records, and both
 * have to name a copy of one. One function does it, so the two doors cannot
 * drift: the same title and folder give the same path, whichever door the
 * person used.
 *
 * A segment is lower-case words joined by "-", at most 64 characters, so the
 * `-copy` suffix is reserved inside the limit instead of being cut off by it,
 * and a title's dots and other punctuation become "-" (a page path has none).
 */

/** The longest a path segment may be (records' PAGE_PATH, §2.3). */
export const MAX_SEGMENT = 64

/** A page-path segment for arbitrary text: lower-case, "-"-joined, at most `max` characters. */
export function pageSlug(value, max = MAX_SEGMENT) {
  const limit = Number.isInteger(max) && max > 0 ? Math.min(max, MAX_SEGMENT) : MAX_SEGMENT
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
  return slug.slice(0, limit).replace(/-+$/, "")
}

/**
 * Where a copy of a page goes: the path the person named, else `<name>-copy`
 * in the folder they chose, else beside the original. `page.title` names it,
 * and the original's last segment when the title is empty.
 *
 * The suffix is kept whole: the name before it takes the room that is left.
 */
export function copyPathFor({ page, path, folder } = {}) {
  const original = String(path ?? "")
  const last = original.split("/").at(-1) || "page"
  const base = pageSlug(page?.title || last, MAX_SEGMENT - "-copy".length) || pageSlug("page")
  const name = `${base}-copy`
  const into = String(folder ?? "").trim().replace(/\/*$/, "")
  if (into) return `${into}/${name}`
  const parts = original.split("/")
  return parts.length > 1 ? `${parts.slice(0, -1).join("/")}/${name}` : name
}
