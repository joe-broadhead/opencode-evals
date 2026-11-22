/**
 * The daily journal page `journal/YYYY-MM-DD` (memory-funnel-v1.md §8):
 * Summary; By project; Decisions; Commitments (new, closed, overdue); People;
 * Reading; Open threads; Sources (collapsed); and a footer with counts, tokens
 * and the routine version. Every bullet ends with a citation: `[turn msg-…]`,
 * `[event evt_…]` or `[[record]]`.
 */
import { dueDay, longDay, shortDay } from "./dates.js"
import { cleanLine, normaliseTitle, shapes } from "./guards.js"
import { decisionEvidence } from "./extract.js"

export const CITATION = /\[(?:turn|event) [^\]\s]+\]|\[\[[^\]]+\]\]/

export function cite(info) {
  if (!info) return ""
  return info.type === "turn" ? `[turn ${info.ref}]` : `[event ${info.ref}]`
}

const link = (path, label) => (label ? `[[${path}|${cleanLine(label, 60)}]]` : `[[${path}]]`)

/** A title from external text, or a neutral one when it is unsafe. */
const WITHHELD = "(subject withheld)"

export function safeTitle(text, fallback = "(untitled)") {
  const t = cleanLine(text, 120)
  if (!t) return fallback
  return shapes(t).any ? WITHHELD : t
}

/**
 * A source's own title, as the page may print it. The trait gate withholds one
 * that carries a sensitive trait (design §5.4, trust H5): a subject line is
 * source text, and the page it is copied to is indexed and shown.
 */
function printTitle(text, withheld, fallback = "(untitled)") {
  const t = String(text ?? "")
  // Matched the way the gate withheld it: the Re:/Fwd: prefix is not the title.
  if (withheld && withheld.has(normaliseTitle(t))) return WITHHELD
  return safeTitle(t, fallback)
}

function safeUrl(url) {
  const u = String(url ?? "")
  return /^https?:\/\/[^\s<>()[\]"']{1,200}$/.test(u) ? u : ""
}

function fmt(n) {
  return Number(n || 0).toLocaleString("en-GB")
}

/**
 * @param {object} input
 * @returns {string} the page body
 */
export function renderJournal(input) {
  const {
    day,
    tz,
    version,
    units,
    refs,
    decided,
    people,
    overdue = [],
    newPeople = [],
    late = [],
    counts,
    stats,
    index,
    withheld = null,
  } = input
  const titleOf = (path) => index.people.find((p) => p.path === path)?.title ?? index.projects.find((p) => p.path === path)?.title ?? newPeople.find((p) => p.path === path)?.title
  const L = []
  const bullet = (text, citation) => {
    if (citation) L.push(`- ${text} ${citation}`)
  }
  const itemCite = (d) => [d.record ? `[[${d.record}]]` : "", cite(refs.get(d.item.ref))].filter(Boolean).join(" ")
  const itemText = (d) => d.item.type === "decision" && decisionEvidence(refs.get(d.item.ref), d.item.quote) === "proposal" ? `Proposed: ${d.item.text}` : d.item.text
  const of = (types, outcomes) => decided.filter((d) => types.includes(d.item.type) && outcomes.includes(d.outcome))

  L.push(`# Journal: ${longDay(day)}`, "")

  // Summary
  const opened = of(["commitment_open"], ["apply"]).filter((d) => !d.known)
  const closed = of(["commitment_close"], ["apply"])
  const decisions = of(["decision", "fact", "preference", "constraint", "procedure", "supersede"], ["apply", "propose"])
  const waiting = decided.filter((d) => d.outcome === "propose").length
  const sourceList = Object.entries(counts).map(([s, n]) => `${s} ${n}`).join(", ") || "none"
  L.push("## Summary", "")
  L.push(
    `${units.length} threads and sessions from ${stats.items} items (${sourceList}); ${of(["decision"], ["apply"]).filter((d) => !d.known).length} decisions recorded, ${opened.length} commitments opened, ${closed.length} closed, ${waiting} items waiting for review.`,
  )
  // In propose mode nothing is applied, so "0 decisions recorded" says nothing
  // about the yield: say how many items the console will review (FINDINGS 1.3).
  if (stats.proposeMode) L.push(`Routines propose only: ${waiting} ${waiting === 1 ? "item waits" : "items wait"} for review in the console and none is applied.`)
  if (stats.budgetStopped) L.push(`Stopped at the daily model budget: ${stats.unreadUnits} threads were not read by the model.`)
  // A day the queue caught up (FINDINGS R6): say when it was read, and which
  // units were read late, so the page never claims a reading the day did not have.
  if (stats.catchUp && stats.catchUp.units > 0) {
    L.push(`${stats.catchUp.units} ${stats.catchUp.units === 1 ? "thread was" : "threads were"} read late, on ${longDay(stats.catchUp.on)}.`)
  }
  if (stats.llmError) L.push(`The model failed on part of the day (${cleanLine(stats.llmError, 120)}); those threads appear only under Sources.`)
  // Only what the provider billed is charged (scale H5): say what that is.
  if (stats.llmError && Number.isFinite(stats.failedTokens)) L.push(stats.failedTokens > 0 ? `The provider billed ${fmt(stats.failedTokens)} tokens for the calls that failed.` : "The provider billed nothing for the calls that failed.")
  L.push("")
  const top = [...of(["decision"], ["apply"]).filter((d) => !d.known), ...opened, ...closed, ...of(["highlight"], ["journal"])].slice(0, 5)
  for (const d of top) bullet(d.item.text, itemCite(d))
  if (top.length) L.push("")

  // By project
  const projects = new Map()
  for (const unit of units) for (const p of unit.projects) projects.set(p, [...(projects.get(p) ?? []), unit])
  for (const d of decided) for (const p of d.item.entities) if (p.startsWith("projects/") && !projects.has(p)) projects.set(p, [])
  if (projects.size > 0) {
    L.push("## By project", "")
    for (const [path, list] of projects) {
      L.push(`### ${link(path, titleOf(path))}`, "")
      const lines = decided.filter((d) => d.outcome !== "drop" && d.item.entities.includes(path))
      for (const d of lines.slice(0, 8)) bullet(`${itemText(d)}${d.outcome === "propose" ? " (waiting for review)" : ""}`, itemCite(d))
      for (const unit of list.slice(0, 6)) if (!lines.some((d) => refs.get(d.item.ref)?.unit === unit.uid)) bullet(`${printTitle(unit.title, withheld)} (${unit.items.length} items)`, cite(refs.get(unit.items[0].ref)))
      L.push("")
    }
  }

  // Decisions
  if (decisions.length > 0) {
    L.push("## Decisions", "")
    for (const d of decisions) {
      const tag = d.known ? " (already recorded)" : d.outcome === "apply" ? "" : d.item.type === "supersede" ? " (proposed change to an existing record; waiting for review)" : ` (${d.stated_by === "person" ? "" : `stated by ${d.stated_by === "agent" ? "the agent" : "someone else"}; `}waiting for review)`
      bullet(`${d.item.type === "decision" ? "" : `${d.item.type}: `}${itemText(d)}${tag}`, itemCite(d))
    }
    L.push("")
  }

  // Commitments
  const proposedOpen = of(["commitment_open"], ["propose"])
  const proposedClose = of(["commitment_close"], ["propose"])
  if (opened.length + closed.length + overdue.length + proposedOpen.length + proposedClose.length > 0) {
    L.push("## Commitments", "")
    const ownerText = (d) => (d.item.owner === "user" || !d.item.owner ? "you" : d.item.owner.startsWith("people/") ? link(d.item.owner, titleOf(d.item.owner)) : cleanLine(d.item.owner, 60))
    const dueText = (d) => (d.item.due ? `, due ${shortDay(d.item.due)}` : d.item.trigger ? `, when ${d.item.trigger}` : "")
    if (opened.length + proposedOpen.length) {
      L.push("### New", "")
      for (const d of [...opened, ...proposedOpen]) bullet(`${d.item.text} (${ownerText(d)}${dueText(d)})${d.outcome === "propose" ? " (waiting for review)" : ""}`, itemCite(d))
      L.push("")
    }
    if (closed.length + proposedClose.length) {
      L.push("### Closed", "")
      for (const d of [...closed, ...proposedClose]) bullet(`${d.item.text}${d.outcome === "propose" ? " (waiting for review)" : ""}`, [`[[${d.item.commitment_id}]]`, itemCite(d)].join(" "))
      L.push("")
    }
    if (overdue.length) {
      L.push("### Overdue", "")
      for (const c of overdue) bullet(`${cleanLine(c.fields?.what ?? c.title, 160)} (due ${shortDay(dueDay(c.fields.due, tz))})`, `[[${c.id}]]`)
      L.push("")
    }
  }

  // People
  if (people.length > 0 || newPeople.length > 0) {
    L.push("## People", "")
    const fresh = new Set(newPeople.map((p) => p.path))
    for (const p of people.slice(0, 20)) bullet(`${link(p.path, titleOf(p.path))}: ${p.count} ${p.count === 1 ? "thread" : "threads"}${fresh.has(p.path) ? " (new page)" : ""}`, cite(refs.get(p.ref)))
    for (const p of newPeople.filter((n) => !people.some((q) => q.path === n.path))) bullet(`${link(p.path, p.title)}: new page`, cite(refs.get(p.ref)))
    L.push("")
  }

  // Reading
  const reading = units.filter((u) => u.kind === "bookmark")
  if (reading.length > 0) {
    L.push("## Reading", "")
    for (const u of reading.slice(0, 20)) {
      const info = refs.get(u.items[0].ref)
      const url = safeUrl(info?.url)
      bullet(`${printTitle(u.title, withheld)}${url ? ` <${url}>` : ""}`, cite(info))
    }
    L.push("")
  }

  // Read late: the units a catch-up run sent for this day (FINDINGS R6).
  if (late.length > 0) {
    L.push("## Read late", "")
    for (const u of late.slice(0, 20)) bullet(`${safeTitle(u.title)} (${u.items.length} ${u.items.length === 1 ? "item" : "items"})`, cite(refs.get(u.items[0].ref)))
    if (late.length > 20) L.push(`${late.length - 20} more were read late and are not listed.`)
    L.push("")
  }

  // Open threads: a thread the person is part of (they wrote in it, or a mail
  // was addressed to them) whose newest message is someone else's.
  const open = units.filter((u) => {
    if (!["message", "issue", "pr"].includes(u.kind) || u.items[0].segments.some((s) => s.author.self)) return false
    const took = u.items.some((i) => i.segments.some((s) => s.author.self))
    return took || (u.source === "gmail" && u.items[0].addressed === true)
  })
  if (open.length > 0) {
    L.push("## Open threads", "")
    for (const u of open.slice(0, 12)) {
      const last = u.items[0].segments[u.items[0].segments.length - 1].author
      const who = last.path ? link(last.path, titleOf(last.path)) : "someone outside your pages"
      bullet(`${printTitle(u.title, withheld)}: last from ${who}`, cite(refs.get(u.items[0].ref)))
    }
    L.push("")
  }

  // Sources (collapsed)
  const all = [...refs.values()]
  L.push("## Sources", "", `<details><summary>${all.length} sources</summary>`, "")
  for (const info of all.slice(0, 300)) {
    const url = safeUrl(info.url)
    bullet(`${info.source}${info.title ? ` · ${printTitle(info.title, withheld)}` : ""}${url ? ` · <${url}>` : ""}`, cite(info))
  }
  if (all.length > 300) L.push(`${all.length - 300} more sources are not listed.`)
  L.push("", "</details>", "")

  // Footer
  L.push(
    "---",
    `_${version} · ${units.length} threads · ${stats.items} items · ${stats.noise} dropped as noise · ${stats.withheld} withheld as instruction-, permission- or share-shaped · ${stats.rejected} model items rejected · ${stats.truncated ?? 0} answers cut off at the output cap · ${stats.known ?? 0} already recorded · ${stats.dropped ?? 0} dropped by policy · ${stats.calls} model calls · ${fmt(stats.tokens)} of ${fmt(stats.budget)} tokens${stats.budgetStopped ? " · stopped at the budget" : ""} · run ${stats.runId}_`,
  )
  return L.join("\n")
}

/** Bullet lines of a page that carry no citation (the scorer and tests use it). */
export function uncitedBullets(body) {
  return String(body ?? "")
    .split("\n")
    .filter((l) => /^\s*[-*] /.test(l) && !CITATION.test(l))
}

/** Every citation marker on a line, for stripping them before a text check. */
const CITATION_ALL = new RegExp(CITATION.source, "g")

/**
 * The cited bullet lines of a journal body, with the section they sit under.
 * Used to carry an earlier run's lines into a later run's page (review H2).
 *
 * @returns {Array<{section: string|null, line: string}>}
 */
export function citedBullets(body) {
  const out = []
  let section = null
  for (const line of String(body ?? "").split("\n")) {
    const heading = /^##\s+(.*)$/.exec(line)
    if (heading) {
      section = heading[1].trim()
      continue
    }
    if (/^\s*[-*] /.test(line) && CITATION.test(line)) out.push({ section, line })
  }
  return out
}

/** The source refs a line cites: `[turn msg-…]`, `[event evt_…]`. */
export function refsCited(line) {
  return [...String(line ?? "").matchAll(/\[(?:turn|event) ([^\]\s]+)\]/g)].map((m) => m[1])
}

/** The record ids a line cites: `[[rec_…]]`. */
export function recordsCited(line) {
  return [...String(line ?? "").matchAll(/\[\[(rec_[^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((m) => m[1])
}

/**
 * The kept lines a run may write back: not one whose cited ref a person forgot
 * (`blocked`, from `routineCheck`), and not one whose cited record is gone
 * (`alive`, the records this space still holds; null when it could not be
 * asked). Review of S0: the merge checked only the line's text, so a line
 * about a forgotten source came back.
 *
 * A line whose title the trait gate now withholds is kept with the title
 * replaced, by the same test the gate uses on a new line (review M1): a 0.12.6
 * journal holds the title in clear, and a partial re-run merged it back beside
 * the run's own `(subject withheld)`.
 *
 * @param {Array<{section: string|null, line: string}>} kept
 * @param {{blocked?: number[], alive?: Set<string>|null, withheld?: Set<string>|Iterable<string>,
 *   withheldRefs?: Iterable<string>}} [checks]
 */
export function survivingLines(kept, { blocked = [], alive = null, withheld = [], withheldRefs = [] } = {}) {
  const out = new Set(blocked)
  const titles = [...withheld].filter(Boolean)
  const refs = new Set(withheldRefs.filter(Boolean))
  return kept
    .filter((entry, index) => !out.has(index) && (alive === null || recordsCited(entry.line).every((id) => alive.has(id))))
    // The robust rule: a line that cites a ref whose title the gate withholds
    // today goes, whatever its text says (review M1).
    .filter((entry) => !refsCited(entry.line).some((ref) => refs.has(ref)))
    .map((entry) => (titles.length === 0 ? entry : { ...entry, line: withheldInLine(entry.line, titles) }))
}

/** Escape a title so it is matched literally inside a line. */
const escapeTitle = (text) => String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

/**
 * An earlier journal line with every title the gate withholds replaced by
 * `(subject withheld)`.
 *
 * Two forms are matched, because the earlier line holds the *printed* title and
 * not the raw one (review M1): the journal takes a title through `cleanLine`,
 * which cuts at 120 characters, masks an address and strips markup, so a title
 * over 120 characters, one with an email in it and one with HTML all printed as
 * something the raw comparison never found. The printed form is matched beside
 * the title itself, both normalised the way the gate normalises a title.
 */
export function withheldInLine(line, withheld = []) {
  let out = String(line ?? "")
  for (const title of withheld) {
    const raw = String(title ?? "").trim()
    if (!raw) continue
    const forms = new Set([raw, normaliseTitle(safeTitle(raw, ""))])
    for (const form of forms) {
      if (!form) continue
      const pattern = new RegExp(escapeTitle(form).replace(/\s+/g, "\\s+"), "gi")
      out = out.replace(pattern, WITHHELD)
    }
  }
  return out
}

/** A kept line's text without its citation markers: what a forget check reads. */
export function withoutCitation(line) {
  return String(line ?? "").replace(CITATION_ALL, "").replace(/\s+/g, " ").trim()
}

/**
 * A re-run of part of a day keeps what an earlier run already wrote. The new
 * body is the run's own; every kept line the new body does not carry goes back
 * into its own section, and one whose section is gone goes under
 * "Read earlier today" (review finding H2: a highlight lives only in the
 * journal, so a partial read must never drop it).
 *
 * @param {string} body the new body
 * @param {Array<{section: string|null, line: string}>} kept the earlier cited lines
 * @returns {string}
 */
export function mergeJournals(body, kept = []) {
  const out = String(body ?? "").split("\n")
  const headingAt = (name) => out.findIndex((line) => line.trim() === `## ${name}`)
  const groups = new Map()
  for (const { section, line } of kept) {
    if (out.some((present) => present.trim() === String(line).trim())) continue
    const key = section ?? ""
    groups.set(key, [...(groups.get(key) ?? []), line])
  }
  const leftovers = []
  for (const [section, lines] of groups) {
    const at = section ? headingAt(section) : -1
    if (at === -1) {
      leftovers.push(...lines)
      continue
    }
    let end = out.length
    for (let i = at + 1; i < out.length; i += 1) {
      if (/^##\s+/.test(out[i]) || out[i].trim() === "---") {
        end = i
        break
      }
    }
    let insertAt = at + 1
    for (let i = at + 1; i < end; i += 1) if (/^\s*[-*] /.test(out[i])) insertAt = i + 1
    // A section whose bullets are followed by a blank line keeps that blank
    // line after the kept ones, as every section of the page is written.
    if (insertAt === at + 1 && out[insertAt] === "") insertAt += 1
    out.splice(insertAt, 0, ...lines)
  }
  if (leftovers.length > 0) {
    const at = headingAt("Sources")
    const block = ["## Read earlier today", "", ...leftovers, ""]
    if (at === -1) {
      const footer = out.findIndex((line) => line.trim() === "---")
      out.splice(footer === -1 ? out.length : footer, 0, ...block, "")
    } else out.splice(at, 0, ...block)
  }
  return out.join("\n")
}
