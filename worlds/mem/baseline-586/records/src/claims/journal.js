/**
 * S2 item 7: the journal as a view (docs/design/memory-routines-v1.md §4.4).
 * A day's page is rendered from the claims and their projection lines, with no
 * model call. Its day is the local day of the cited items' `occurred_at`; its
 * Summary is the top five by a fixed ranking; and Open threads, Reading and
 * Sources still come from the day's events. A page the person edited is never
 * rewritten: a late line for it goes to today's page under Late arrivals.
 */
import { localDay, longDay } from "../routines/dates.js"
import { claimsEnabled } from "./flag.js"
import { readLine } from "./projections.js"
import { readClaim } from "./rows.js"

const CITATION = /\[claim clm_[0-9A-Z]+\]/

/**
 * @param {{day: string, tz: string, claims?: object[], lines?: object[], items?: Map<string, object>,
 *   events?: object[], edited?: boolean, version?: string}} input
 * @param {{env?: Record<string, string | undefined>}} [options]
 */
export function renderClaimsJournal(input, { env = process.env } = {}) {
  if (!claimsEnabled(env)) return null
  const { day, tz } = input
  if (!day || !tz) throw new Error("A journal view needs a day and the space's time zone.")
  const claims = (input.claims ?? []).map((claim) => ("claim_key" in claim ? claim : readClaim(claim)))
  const lines = (input.lines ?? []).map((line) => ("line_key" in line ? line : readLine(line)))
  const byId = new Map(claims.map((claim) => [claim.id, claim]))
  const items = input.items instanceof Map ? input.items : new Map(Object.entries(input.items ?? {}))
  const dayOf = (ref) => {
    const item = items.get(ref)
    return item?.occurred_at ? localDay(item.occurred_at, tz) : null
  }
  const daysOf = (claim) => new Set(claim.refs.map(dayOf).filter(Boolean))
  const onDay = (line) =>
    line.claims.some((id) => {
      const claim = byId.get(id)
      return claim ? daysOf(claim).has(day) : false
    })
  const mine = (line) => line.claims.some((id) => byId.get(id)?.stated_by === "person")
  const commitmentState = (line) => line.payload?.commitment ?? "open"
  const todays = lines.filter(onDay)
  const body = input.edited ? null : render({ day, lines: todays, version: input.version ?? "claims@v1", events: input.events ?? [], mine, commitmentState })
  const late = input.edited ? lateArrivals({ day, tz, lines, byId, items, mine }) : []
  return { path: `journal/${day}`, body, lines: todays.length, late, model_calls: 0 }
}

/** The lines that arrived today about an older item, for the edited page's Late arrivals. */
export function lateArrivals({ day, tz, lines, byId, items, mine }) {
  const out = []
  for (const line of lines) {
    const cited = line.claims.map((id) => byId.get(id)).filter(Boolean)
    if (cited.length === 0) continue
    const filed = cited.map((claim) => localDay(claim.last_seen, tz))
    const itemDays = cited.flatMap((claim) => claim.refs.map((ref) => items.get(ref)?.occurred_at).filter(Boolean).map((at) => localDay(at, tz)))
    if (!filed.includes(day) || itemDays.length === 0) continue
    const first = [...itemDays].sort()[0]
    if (first >= day) continue
    out.push({ line_key: line.line_key, text: line.text, day: first, back_link: `journal/${first}`, citation: citationOf(line), mine: mine(line) })
  }
  return out.sort((a, b) => a.day.localeCompare(b.day) || a.line_key.localeCompare(b.line_key))
}

function citationOf(line) {
  return line.claims.length ? `[claim ${line.claims[0]}]` : ""
}

function render({ day, lines, version, events, mine, commitmentState }) {
  const L = []
  const bullet = (text, citation) => {
    if (citation) L.push(`- ${text} ${citation}`)
  }
  const summary = rankSummary(lines, mine, commitmentState)
  L.push(`# Journal: ${longDay(day)}`, "")
  L.push("## Summary", "")
  L.push(`${lines.length} lines from the day's claims.`)
  for (const line of summary) bullet(line.text, citationOf(line))
  if (summary.length) L.push("")

  const section = (title, chosen) => {
    if (chosen.length === 0) return
    L.push(`## ${title}`, "")
    for (const line of chosen) bullet(line.text, citationOf(line))
    L.push("")
  }
  section("Decisions", lines.filter((line) => line.type === "decision"))
  section("Commitments", lines.filter((line) => line.type === "commitment"))
  section("Facts", lines.filter((line) => line.type === "fact"))
  section("Preferences", lines.filter((line) => line.type === "preference"))
  section("Constraints", lines.filter((line) => line.type === "constraint"))

  const open = events.filter((event) => ["message", "issue", "pr"].includes(event.kind) && event.open === true)
  if (open.length > 0) {
    L.push("## Open threads", "")
    for (const event of open.slice(0, 12)) bullet(`${event.title ?? "(untitled)"}: last from ${event.last_from ?? "someone outside your pages"}`, `[event ${event.id}]`)
    L.push("")
  }
  const reading = events.filter((event) => event.kind === "bookmark")
  if (reading.length > 0) {
    L.push("## Reading", "")
    for (const event of reading.slice(0, 20)) bullet(event.title ?? "(untitled)", `[event ${event.id}]`)
    L.push("")
  }
  L.push("## Sources", "", `<details><summary>${events.length} sources</summary>`, "")
  for (const event of events.slice(0, 300)) bullet(`${event.source ?? "source"}${event.title ? ` · ${event.title}` : ""}`, `[event ${event.id}]`)
  L.push("", "</details>", "")
  L.push("---", `_${version} · ${lines.length} lines · ${events.length} events · no model call_`)
  return L.join("\n")
}

/**
 * The fixed ranking: the person's own decisions, then commitments opened, then
 * commitments closed, then others' decisions. Five at most.
 */
export function rankSummary(lines, mine = () => false, commitmentState = () => "open") {
  const ranked = []
  const rank = (line) => {
    if (line.type === "decision" && mine(line)) return 0
    if (line.type === "commitment") {
      const state = commitmentState(line)
      if (state === "open") return 1
      if (state === "done" || state === "cancelled") return 2
    }
    if (line.type === "decision") return 3
    return 4
  }
  for (const line of lines) ranked.push({ line, rank: rank(line) })
  return ranked
    .sort((a, b) => a.rank - b.rank || a.line.line_key.localeCompare(b.line.line_key))
    .slice(0, 5)
    .map((entry) => entry.line)
}

/** Bullet lines that carry no citation (the scorer and tests use it). */
export function uncitedBullets(body) {
  return String(body ?? "")
    .split("\n")
    .filter((line) => /^\s*[-*] /.test(line) && !CITATION.test(line) && !/\[event /.test(line))
}
