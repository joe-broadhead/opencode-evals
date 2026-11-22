/**
 * Text helpers: titles, sections, snippets and the full-text query.
 */
import { redactErrorText, secretKinds } from "./storable.js"

/** What is kept of a failure when redaction still finds a secret: safe, and says so. */
export const WITHHELD_ERROR = "details withheld: they may contain a secret"

/**
 * A source's or a broker's own words, safe to store or answer (0.11 review B1):
 * one line, the same redaction the plugin's answers use (`redactErrorText`,
 * carried by both `storable.js` copies), and withheld whole when a secret
 * survives it. Readable: the code, the failing step and the HTTP status stay.
 */
export function errorText(value, max = 400) {
  const text = redactErrorText(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return ""
  if (secretKinds(text).length > 0) return WITHHELD_ERROR
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** A message that already names a code (`AUTH_REQUIRED: …`): a second one would be noise. */
const CODED_PREFIX = /^[A-Z][A-Z0-9_]+: /

/** What `String()` makes of an object: never a reason a person should read. */
const PLACEHOLDER = "[object Object]"

/**
 * A collection's failure as one line of text a person reads: `CODE: message`
 * when the failure names a code, else its message (0.12.3).
 *
 * A plugin sends text, but a report is not only this release's: an older
 * collector, or another one, may send the failure as `{code, message}` — and
 * `String(object)` is `[object Object]`, which is what Sources showed as the
 * whole of "Why: …". So the object is read for its two fields here, at the
 * store, and the placeholder is never what is kept.
 *
 * @param {unknown} value a string, an `Error`, or `{code, message}`
 * @param {number} [max]
 */
export function failureText(value, max = 300) {
  const code = typeof value?.code === "string" ? value.code.trim() : typeof value?.error?.code === "string" ? String(value.error.code).trim() : ""
  const said =
    typeof value?.message === "string"
      ? value.message
      : typeof value?.error?.message === "string"
        ? value.error.message
        : typeof value === "string"
          ? value
          : ""
  const named = errorText(code, 60)
  const text = errorText(said, max)
  // Nothing said, or the placeholder `String(object)` makes: the reason is
  // still a sentence, and the code still names what happened.
  if (!text || text === PLACEHOLDER) return named ? errorText(`${named}: the collection failed`, max) : errorText("the collection failed", max)
  // `UNAVAILABLE` is the contract's word for "the read failed, retry": a
  // failure that names nothing more specific reads as its own sentence.
  if (!named || named === "UNAVAILABLE" || text === named || CODED_PREFIX.test(text)) return text
  return errorText(`${named}: ${text}`, max)
}

const STOPWORDS = new Set(
  "a an and are as at be been but by can do does for from had has have he her his i if in into is it its me my no not of on or our she so than that the their them then there these they this to too us was we were what when where which who why will with you your".split(
    " ",
  ),
)

/** Plain text of a Markdown line: links become their label, emphasis and list marks go. */
function plain(line) {
  return line
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}\s+|[-*+]\s+|>\s*|\d+\.\s+)/, "")
    .replace(/[*_`]+/g, "")
    .trim()
}

/** A title from the first non-empty line of a body, cut at a word to `max` characters. */
export function titleFromBody(body, max = 120) {
  for (const line of String(body ?? "").split("\n")) {
    const text = plain(line)
    if (text) return cut(text, max)
  }
  return ""
}

/** A title from a path's last segment: "people/ama-owusu" → "Ama owusu". */
export function titleFromPath(path) {
  const last = String(path ?? "").split("/").pop() ?? ""
  const words = last.replace(/-/g, " ").trim()
  return words ? words[0].toUpperCase() + words.slice(1) : ""
}

export function cut(text, max) {
  const value = String(text ?? "")
  if (value.length <= max) return value
  const head = value.slice(0, max - 1)
  const space = head.lastIndexOf(" ")
  return `${(space > max * 0.6 ? head.slice(0, space) : head).trimEnd()}…`
}

const HEADING = /^(#{1,6})\s+(.*?)\s*#*\s*$/

/**
 * Append `text` to the `## section` of a Markdown body, after the section's
 * last non-empty line. A missing section is added at the end. Headings inside
 * code fences are ignored.
 */
export function appendToSection(body, section, text) {
  const lines = String(body ?? "").split("\n")
  const want = section.trim().toLowerCase()
  const add = text.split("\n")
  let start = -1
  let end = lines.length
  let fence = false
  for (let i = 0; i < lines.length; i += 1) {
    if (/^\s*(```|~~~)/.test(lines[i])) fence = !fence
    if (fence) continue
    const match = HEADING.exec(lines[i])
    if (!match) continue
    if (start === -1) {
      if (match[1].length === 2 && match[2].trim().toLowerCase() === want) start = i
    } else if (match[1].length <= 2) {
      end = i
      break
    }
  }
  if (start === -1) {
    const trimmed = String(body ?? "").replace(/\s+$/, "")
    return `${trimmed ? `${trimmed}\n\n` : ""}## ${section.trim()}\n${add.join("\n")}\n`
  }
  let at = start + 1
  for (let k = end - 1; k > start; k -= 1) {
    if (lines[k].trim()) {
      at = k + 1
      break
    }
  }
  lines.splice(at, 0, ...add)
  const joined = lines.join("\n")
  return joined.endsWith("\n") ? joined : `${joined}\n`
}

/**
 * Words of a query for FTS5, each quoted (porter still stems inside quotes):
 * `all` needs every word, `any` needs one. Search runs `all` first and fills
 * up with `any`, so records holding every word rank first and a query of
 * common words never scores every record that holds one of them.
 */
export function ftsQuery(text) {
  const words = String(text ?? "")
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu) ?? []
  const meaningful = [...new Set(words.filter((word) => word.length > 1 && !STOPWORDS.has(word)))]
  const chosen = (meaningful.length > 0 ? meaningful : [...new Set(words)]).slice(0, 16)
  const quoted = chosen.map((word) => `"${word}"`)
  return { all: quoted.join(" "), any: quoted.join(" OR "), words: chosen }
}

/**
 * Up to `max` characters of a body around the first word of the query found
 * in it (matching a stem-sized prefix), on one line.
 */
export function snippet(body, words, max = 240) {
  const flat = String(body ?? "").replace(/\s+/g, " ").trim()
  if (flat.length <= max) return flat
  const lower = flat.toLowerCase()
  let at = -1
  for (const word of words) {
    const stem = word.length > 4 ? word.slice(0, Math.max(4, word.length - 2)) : word
    const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${stem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "u")
    const found = pattern.exec(lower)
    if (found && (at === -1 || found.index < at)) at = found.index
  }
  if (at <= 0) return cut(flat, max)
  let start = Math.max(0, at - Math.floor(max / 4))
  const space = flat.lastIndexOf(" ", start)
  if (space > 0 && start - space < 20) start = space + 1
  const lead = start > 0 ? "…" : ""
  const room = max - lead.length
  const rest = flat.slice(start)
  return lead + (rest.length <= room ? rest : cut(rest, room))
}

/**
 * A line that would hide, fence or restyle the lines around it on a team page
 * (FIX-0911): an HTML comment marker; a real HTML tag (`<`, an optional `/`, a
 * letter, tag-name characters, then whitespace, `/` or `>`, closed by `>` on
 * the same line: `<details>`, `</div>`, `<img src=x>`, but not `a<b`, `<= 5`
 * or `<https://…>`); a code fence; or a setext underline of any length (`-`,
 * `=`, `---`), which turns the line above into a heading. The plugin's
 * src/tools/page.js holds the same rule.
 */
const RESTYLING_LINE = /<!--|-->|<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/][^>]*)?>|^\s*(?:```|~~~)|^\s*[=-]+\s*$/

/** An inserted line in a bearer's page update: RESTYLING_LINE, or indented (which joins the bullet above an old line). */
const HIDING_LINE = new RegExp(`${RESTYLING_LINE.source}|^\\s`)

/**
 * Whether text appended to a team page could restyle what is there: a line
 * RESTYLING_LINE refuses or a heading, or a first line that starts with
 * whitespace (it would join the line above). Indented lines after the first,
 * such as nested bullets, are fine.
 */
export function restylesTeamPage(text) {
  const lines = String(text ?? "").split("\n")
  if (/^\s/.test(lines[0] ?? "")) return true
  return lines.some((line) => line.trim() !== "" && (RESTYLING_LINE.test(line) || /^\s*#{1,6}\s/.test(line)))
}

/**
 * Whether `after` only inserts lines into `before` (FIX-0911): every
 * non-blank line of `before`, with trailing spaces ignored, appears in `after`
 * unchanged and in the same order, and no inserted line opens or closes an
 * HTML comment or a code fence. A line-sequence property, never a substring
 * one: an extended, struck-through, prefixed, wrapped, moved or renamed line
 * is a change.
 *
 * @param {string} before
 * @param {string} after
 * @returns {{ ok: boolean, missing: string[], hiding: string[] }}
 */
export function insertedOnly(before, after) {
  const lines = (text) => String(text ?? "").split("\n").map((line) => line.replace(/\s+$/, "")).filter((line) => line.trim() !== "")
  const old = lines(before)
  let next = 0
  const inserted = []
  for (const line of lines(after)) {
    if (next < old.length && line === old[next]) next += 1
    else inserted.push(line)
  }
  const missing = old.slice(next)
  const hiding = inserted.filter((line) => HIDING_LINE.test(line))
  return { ok: missing.length === 0 && hiding.length === 0, missing, hiding }
}
