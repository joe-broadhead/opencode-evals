import { createHash } from "node:crypto"

/**
 * The `## sections` of a page body, read the way the records store's
 * `records.append` reads them (records/src/text.js appendToSection): a level-2
 * heading starts a section, the next heading of level 1 or 2 ends it, and
 * headings inside code fences are ignored. mem_page `replace` uses them to
 * change one section without rewriting the page.
 */

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

/** Every level-2 section: its heading text, and the line range of its text. */
export function sectionsOf(body) {
  const lines = String(body ?? "").split("\n")
  const sections = []
  let fence = false
  let open = null
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    const match = HEADING.exec(lines[i])
    if (!match || match[1].length > 2) continue
    if (open) {
      open.end = i
      sections.push(open)
      open = null
    }
    if (match[1].length === 2) open = { heading: match[2].trim(), line: i, end: lines.length }
  }
  if (open) sections.push(open)
  return { lines, sections }
}

/** A section name as given: trimmed, without leading #s. */
export function sectionName(name) {
  return String(name ?? "").trim().replace(/^#+\s*/, "")
}

/**
 * Which section a name means, for append and replace alike: the one heading
 * that equals it (case aside), else the one heading that starts with it and a
 * space or "(" ("Status" finds "Status (as of 2026-11-12)"). `ambiguous` lists
 * every match, with its 1-based line, when the name fits more than one; a
 * name that fits none is `{ missing: true }` (append and replace add it).
 *
 * @returns {{ section?: { heading: string, line: number, end: number, text: string }, ambiguous?: { heading: string, line: number }[], missing?: boolean }}
 */
export function resolveSection(body, name) {
  const { lines, sections } = sectionsOf(body)
  const want = sectionName(name).toLowerCase()
  if (!want) return { missing: true }
  const exact = sections.filter((section) => section.heading.toLowerCase() === want)
  const prefixed = sections.filter((section) => {
    const heading = section.heading.toLowerCase()
    return heading.startsWith(`${want} `) || heading.startsWith(`${want}(`)
  })
  const matches = exact.length > 0 ? exact : prefixed
  if (matches.length > 1) return { ambiguous: matches.map((section) => ({ heading: section.heading, line: section.line + 1 })) }
  if (matches.length === 0) return { missing: true }
  const found = matches[0]
  return { section: { ...found, text: lines.slice(found.line + 1, found.end).join("\n").trim() } }
}

/** The one section a name means, or null (none, or more than one). */
export function findSection(body, name) {
  return resolveSection(body, name).section ?? null
}

/** The refusal for a name that fits more than one section. */
export function ambiguousMessage(verb, pagePath, name, matches) {
  const listed = matches.map((match) => `"## ${match.heading}" at line ${match.line}`).join(", ")
  return `not ${verb}: "${sectionName(name)}" matches ${matches.length} sections of ${pagePath}: ${listed}. Nothing was written. Rename or merge one with write (read the page first), then ${verb === "appended" ? "append" : "replace"} again.`
}

/** True when text opens a code fence it does not close: the next heading would be hidden inside it. */
export function unbalancedFence(text) {
  return String(text ?? "").split("\n").filter((line) => /^\s*(```|~~~)/.test(line)).length % 2 === 1
}

/** A short fingerprint of one section's text, or of its absence. */
export function sectionHash(section) {
  return createHash("sha256").update(section ? `${section.heading.toLowerCase()}\n${section.text}` : "\u0000none").digest("hex").slice(0, 16)
}

/** The fingerprint of every section, keyed by lower-case heading, for a later replace's check. */
export function sectionHashes(body) {
  const { sections } = sectionsOf(body)
  const out = {}
  for (const section of sections) {
    const key = section.heading.toLowerCase()
    out[key] = sectionHash(findSection(body, section.heading))
  }
  return out
}

/**
 * The body with one section's text replaced by `text`, its heading line
 * kept. A missing section is added at the end, as an append adds it.
 */
export function replaceSection(body, name, text) {
  const value = String(text ?? "").replace(/\s+$/, "")
  const resolved = resolveSection(body, name)
  if (resolved.ambiguous) return { ambiguous: resolved.ambiguous }
  const found = resolved.section
  if (!found) {
    const trimmed = String(body ?? "").replace(/\s+$/, "")
    return { body: `${trimmed ? `${trimmed}\n\n` : ""}## ${sectionName(name)}\n${value}\n`, heading: sectionName(name), created: true }
  }
  const { lines } = sectionsOf(body)
  const after = lines.slice(found.end)
  const next = [...lines.slice(0, found.line + 1), ...value.split("\n"), ...(after.length > 0 && after.some((line) => line.trim()) ? ["", ...after] : [])]
  const joined = next.join("\n").replace(/\s+$/, "")
  return { body: `${joined}\n`, heading: found.heading, created: false }
}

/**
 * A routine's run-stats line: `Run daily@v1 · 3 sources · 4,120 tokens`, or
 * the journal routine's own `_daily@v1 · 3 threads · … · run <id>_`.
 */
const RUN_STATS = /^(?:Run\s+\S.*·.*|_\S.*·.*_)$/

/**
 * A page's closing routine footer (FIX-0912): its last "---" line and the run
 * stats under it, with no heading in between, as the journal routine writes
 * them. A person's own "---" is not one: the line after it must be run stats
 * (the caller also asks for a routine page), so a plain rule and the text
 * under it stay ordinary section content. `main` is the body before it;
 * `footer` is the block, to keep at the end.
 *
 * @param {string} body
 * @returns {{ main: string, footer: string } | null}
 */
export function splitFooter(body) {
  const lines = String(body ?? "").replace(/\s+$/, "").split("\n")
  let last = lines.length - 1
  while (last >= 0 && !lines[last].trim()) last -= 1
  if (last < 0 || !RUN_STATS.test(lines[last].trim())) return null
  let at = last
  while (at >= 0) {
    if (/^#{1,6}\s/.test(lines[at])) return null
    if (lines[at].trim() === "---") break
    at -= 1
  }
  if (at < 0) return null
  return { main: lines.slice(0, at).join("\n").replace(/\s+$/, ""), footer: lines.slice(at).join("\n") }
}
