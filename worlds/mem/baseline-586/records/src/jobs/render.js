/**
 * The `render` curate engine (DESIGN-MEMORY-JOBS §6.1): no model, fixed
 * placeholders, and every line ends with the event it came from.
 *
 * A job owns one block, between `<!-- lens:<job>/<stage> -->` and
 * `<!-- /lens -->`. The person's own text outside the block is kept as it is;
 * a line the person edits inside the block stops the job writing that block
 * (§6.2, plugin design §4.5) — the caller compares the block with what it
 * would have written and refuses, so this module stays a pure renderer.
 *
 * External text reaches a line only through the same guards the routines use:
 * a sentence shaped like an instruction is dropped, not written, and the line
 * says so. Citations are ids only (`[event evt_…]`, `[[people/…]]`), never the
 * collected text of another entity.
 */
import { createHash } from "node:crypto"
import { cleanLine, redactExternal, shapes } from "../routines/guards.js"
import { lineMarkupProblem } from "../plugins/manifest.js"

export const MAX_LINE = 220
export const LENS_CLOSE = "<!-- /lens -->"

/** The stable open marker of a job's block: the job and stage, never the run. */
export function lensOpen(jobId, stage) {
  return `<!-- lens:${jobId}/${stage} -->`
}

/** A slug for a `[[people/…]]` link: the actor's name, else its id's last part. */
export function personSlug(actor) {
  const name = String(actor?.name ?? "").toLowerCase()
  const fromName = name
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  if (fromName && /^[a-z0-9]/.test(fromName)) return fromName
  const id = String(actor?.id ?? "").split(":").pop().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40)
  return id || "someone"
}

/** The person link a line carries: `[[people/ama|Ama]]`, or a neutral label when there is nobody. */
export function personLink(actor) {
  const label = cleanLine(actor?.name ?? "", 40)
  const slug = personSlug(actor)
  if (!slug || slug === "someone") return label ? label : "someone"
  return label && !shapes(label).any ? `[[people/${slug}|${label}]]` : `[[people/${slug}]]`
}

/**
 * Collected text as **text**: nothing in it can render as an image, and a link
 * keeps its visible label (review P4).
 *
 * **Image syntax is not parsed at all.** Every `![` becomes `[` and every
 * `<img …>` tag is dropped *before* anything else, so no destination, title,
 * parentheses or line break can leave an image behind: the worst an odd form
 * can do is leave a link, which the link rules then reduce to its label. The
 * job's own `[event evt_…]` and `[[people/…]]` are added after this, never
 * through it, and contain no `![`.
 */
export function visibleText(value) {
  return String(value ?? "")
    // First, and unconditionally: an image is not a thing collected text may draw.
    .replace(/<img\b[^>]*>/gi, "")
    .replace(/!\[/g, "[")
    // A markdown definition line (`[ref]: url "title"`), which belongs to no image or link once its use is gone.
    .replace(/(?:^|\n)[ \t]{0,3}\[[^\]\n]+\]:[ \t]*\S[^\n]*/g, "")
    // A link: its label stays (across lines too), its destination and title go. One level of
    // balanced parentheses in the destination, and an angle-bracket form.
    .replace(/\[([^\]]*)\]\(\s*<[^>\n]*>\s*(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))?\s*\)/g, "$1")
    .replace(/\[([^\]]*)\]\(\s*(?:[^\s()<>\n]|\([^\s()<>\n]*\))+\s*(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\))?\s*\)/g, "$1")
    .replace(/\[([^\]]+)\]\[[^\]\n]*\]/g, "$1")
    // An autolink.
    .replace(/<((?:https?|mailto):[^>\s]{1,2000})>/g, "")
}

/** A hash of a block's own lines: the record says which block it wrote (review P1). */
export function lensHash(lines) {
  return `sha256:${createHash("sha256").update([...lines].join("\n")).digest("hex")}`
}

const hhmm = (iso) => (typeof iso === "string" && iso.length >= 16 ? iso.slice(11, 16) : "")

/**
 * The block's lines, oldest first, one per item, each with its citation.
 * @param {{items: {event_id: string, occurred_at: string, title?: string|null, text?: string|null, actors?: object[]}[]}} input
 */
export function renderLines({ items = [], maxLines = 100, line = null, unit = null, urlHosts = [] } = {}) {
  const ordered = [...items].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)) || String(a.event_id).localeCompare(String(b.event_id)))
  const kept = ordered.length > maxLines ? ordered.slice(ordered.length - maxLines) : ordered
  const lines = []
  // A declared template's `line` (§9.4) is used for a stage that renders one
  // line per event. A `unit: thread` stage keeps the per-message lines, which
  // are what shows every message of a thread, the ones a channel read omits too.
  const useLine = typeof line === "string" && line !== "" && unit !== "thread"
  for (const item of kept) {
    if (typeof item.event_id !== "string" || !item.event_id) continue
    if (useLine) {
      const rendered = templatedLine(line, item, urlHosts)
      if (rendered) lines.push(rendered)
      continue
    }
    const author = Array.isArray(item.actors) ? item.actors.find((actor) => actor && typeof actor === "object") : null
    const raw = visibleText(String(item.text ?? item.title ?? ""))
    const { text, removed } = redactExternal(raw)
    const said = cleanLine(text, MAX_LINE)
    if (!said && removed.length === 0) continue
    const when = hhmm(item.occurred_at)
    lines.push([`- ${when ? `${when} ` : ""}${personLink(author)}: ${said || "[removed: instruction-shaped text]"}`, `[event ${item.event_id}]`].join(" "))
  }
  return lines
}

/**
 * One line from a declared template's `line`: the fixed placeholders of §9.4,
 * with the same guards a rendered line gets (text is reduced to text, and an
 * instruction-shaped sentence is never written). The citation is always there,
 * whatever the template says.
 */
function templatedLine(line, item, urlHosts = []) {
  // Every value a template's line takes is collected text, so every one goes
  // through the same two guards: markup is reduced to text (`visibleText`), and
  // a sentence shaped like an instruction is never written (`redactExternal`).
  const guarded = (value, max) => {
    const raw = visibleText(String(value ?? ""))
    const { text, removed } = redactExternal(raw)
    const said = cleanLine(text, max)
    return said || (removed.length ? "[removed: instruction-shaped text]" : "")
  }
  const rawText = visibleText(String(item.text ?? item.title ?? ""))
  const redacted = redactExternal(rawText)
  const said = cleanLine(redacted.text, MAX_LINE)
  const title = guarded(item.title, 120) || said || "(no title)"
  const actors = Array.isArray(item.actors) ? item.actors.filter((actor) => actor && typeof actor === "object") : []
  const when = hhmm(item.occurred_at)
  const values = {
    title,
    count: "1",
    participants: [...new Set(actors.map((actor) => personLink({ ...actor, name: guarded(actor.name, 40) })))].join(", "),
    first_at: when,
    last_at: when,
    text: said || (redacted.removed.length ? "[removed: instruction-shaped text]" : ""),
    cite: `[event ${item.event_id}]`,
    // A URL is a destination, so it renders only when the connector declares its
    // host: an undeclared host's link is dropped rather than written.
    url: renderableUrl(item.url, urlHosts),
  }
  const filled = String(line)
    .replace(/\{(?:metric:[a-z0-9_]+)\}/g, "")
    .replace(/\{([a-z_]+)\}/g, (whole, name) => (name in values ? values[name] : whole))
  const body = `- ${filled}`.replace(/\s+$/, "")
  const line_ = body.includes(values.cite) ? body : `${body} ${values.cite}`
  // The literal text was checked when the declaration was read; a **placeholder's
  // value** was not, and joining two placeholders (`!{title}({url})`) can build
  // markup the template never wrote. A line that carries any is not written.
  return lineMarkupProblem(line_) ? null : line_
}

/**
 * A URL the block may carry: https, and its host is one the connector declares
 * (`connector.urlHosts`, an exact host or a `*.suffix` pattern). Anything else
 * renders as nothing.
 */
export function renderableUrl(value, hosts = []) {
  if (typeof value !== "string") return ""
  let url
  try {
    url = new URL(value)
  } catch {
    return ""
  }
  if (url.protocol !== "https:") return ""
  // The **parser's** href, never the plugin's raw string: a string can carry
  // markup past any host check (`…/a) ![t](https://evil.example/t.png`), and a
  // link is a place a page can be read from. Anything with the characters that
  // build markup, or whitespace, is dropped.
  const href = url.href
  // Both the string and the parser's href: the parser percent-encodes `<` and
  // `[`, so a href-only check would read `%3C` as harmless. Neither may carry
  // the characters that build markup, or whitespace.
  const forbidden = /[\s\[\]()<>!]/
  if (forbidden.test(value) || forbidden.test(href)) return ""
  const host = url.hostname.toLowerCase()
  // A declared host is a domain: `slack.com` carries its subdomains, and
  // `*.slack.com` says the same thing the long way.
  const allowed = (Array.isArray(hosts) ? hosts : []).some((pattern) => {
    const wanted = String(pattern ?? "").toLowerCase().replace(/^\*\./, "")
    if (!wanted) return false
    return host === wanted || host.endsWith(`.${wanted}`)
  })
  return allowed ? href : ""
}

/** The person's text around the block: `{before, after, block, hadBlock}`. */
export function splitLensBlock(body, jobId, stage) {
  const text = String(body ?? "")
  const open = lensOpen(jobId, stage)
  const start = text.indexOf(open)
  if (start === -1) return { before: text.replace(/\s+$/, ""), after: "", block: "", hadBlock: false }
  const end = text.indexOf(LENS_CLOSE, start)
  if (end === -1) return { before: text.slice(0, start).replace(/\s+$/, ""), after: "", block: text.slice(start + open.length), hadBlock: true }
  return {
    before: text.slice(0, start).replace(/\s+$/, ""),
    after: text.slice(end + LENS_CLOSE.length).replace(/^\s+/, ""),
    block: text.slice(start + open.length, end),
    hadBlock: true,
  }
}

/**
 * Every line the block holds, for the edit check. **Any** line inside the block
 * that the job did not write is the person's (review P2), not just the bullets:
 * a line inserted under the block is an edit like any other.
 */
export function blockLines(block) {
  return String(block ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
}

/** True when these lines are exactly the ones given, in order. */
export function sameLines(lines, expected) {
  return lines.length === expected.length && lines.every((line, index) => line === expected[index])
}

/**
 * True when the block holds exactly the lines the job would have written, or no
 * block yet. `wrote` is the hash the record carries for the block the job last
 * wrote: a run that died between the write and its mark still recognises its own
 * block instead of reading it as the person's edit (review P1).
 */
export function unedited(block, expected, { wrote = null, next = null } = {}) {
  const now = blockLines(block)
  if (sameLines(now, expected)) return true
  if (next && sameLines(now, next)) return true
  return Boolean(wrote) && lensHash(now) === wrote
}

/** The page body with the job's block replaced (or added at the end). */
export function mergeLensBlock(body, jobId, stage, lines) {
  const { before, after } = splitLensBlock(body, jobId, stage)
  const parts = []
  if (before) parts.push(before, "")
  parts.push(lensOpen(jobId, stage), ...lines, LENS_CLOSE)
  if (after) parts.push("", after)
  return parts.join("\n")
}

/** The page title a job's block wants: the project's name. */
export function pageTitle(project) {
  return String(project ?? "")
    .split("-")
    .filter(Boolean)
    .map((word) => word.slice(0, 1).toUpperCase() + word.slice(1))
    .join(" ")
}
