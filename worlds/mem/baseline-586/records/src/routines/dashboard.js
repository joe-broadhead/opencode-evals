/**
 * The dashboard, page `index` (memory-funnel-v1.md §8, memory-tools-v1.md §8):
 * at most 60 lines in all, injected at session start. The routine owns only the
 * block between `<!-- routine:dashboard -->` and `<!-- /routine -->`; anything
 * the person writes outside it is kept as it is.
 *
 * The page is pinned in every session, so the routine never puts text there
 * that a person has not accepted (the 0.9.8 routine-safety review): proposals
 * and lint findings are counts only (the console shows them), and any other
 * line whose text is instruction-, permission- or share-shaped is withheld.
 */
import { addDays, dueDay, shortDay } from "./dates.js"
import { cleanLine, shapes } from "./guards.js"

export const OPEN = "<!-- routine:dashboard -->"
export const CLOSE = "<!-- /routine -->"
export const MAX_LINES = 60

/** The person's text around the block: {before, after} (the block removed). */
export function splitDashboard(body) {
  const text = String(body ?? "")
  const start = text.indexOf(OPEN)
  if (start === -1) return { before: text.replace(/\s+$/, ""), after: "", hadBlock: false }
  const end = text.indexOf(CLOSE, start)
  if (end === -1) return { before: text.slice(0, start).replace(/\s+$/, ""), after: "", hadBlock: true }
  return { before: text.slice(0, start).replace(/\s+$/, ""), after: text.slice(end + CLOSE.length).replace(/^\s+/, ""), hadBlock: true }
}

/** The page body with the routine's block replaced (or added at the end). */
export function mergeDashboard(body, blockLines) {
  const { before, after } = splitDashboard(body)
  const parts = []
  if (before) parts.push(before, "")
  parts.push(OPEN, ...blockLines, CLOSE)
  if (after) parts.push("", after)
  return parts.join("\n")
}

function lineCount(text) {
  return text ? text.split("\n").length : 0
}

/**
 * The block's lines, fitted to the space the person's own text leaves.
 *
 * @param {{day: string, tz: string, goals: string[], projects: any[], commitments: any[], decisions: any[], proposals: any[], findings: any[], outside: string, latestJournal?: string}} input
 */
export function renderDashboard({ day, tz, goals = [], projects = [], commitments = [], decisions = [], proposals = [], findings = [], outside = "", latestJournal = null }) {
  const room = Math.max(14, MAX_LINES - lineCount(outside) - 3)
  // Record text in a pinned line: withheld when it is shaped like an instruction.
  const text = (value, n, id) => {
    const line = cleanLine(value, n)
    return shapes(line).any ? `(withheld from the pinned dashboard${id ? `; open [[${id}]]` : ""})` : line
  }
  const findingKinds = new Map()
  for (const f of findings) findingKinds.set(f.kind, (findingKinds.get(f.kind) ?? 0) + 1)
  const due = commitments
    .filter((c) => c.fields?.state === "open")
    .map((c) => ({ c, d: dueDay(c.fields?.due, tz) }))
    .filter(({ d }) => d && d <= addDays(day, 7))
    .sort((a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0))
  const sections = [
    {
      title: "Goals",
      // Goals are pinned too: the same shape guard as every title (slice 7 review).
      lines: goals.length ? goals.map((g) => `- ${text(g, 140)}`) : ["_No goals yet: write them above this block, or in the index page's goals field._"],
      min: 1,
    },
    {
      title: "Active projects",
      lines: projects.map((p) => `- [[${p.path}|${text(p.title, 60)}]] (updated ${shortDay(p.updated.slice(0, 10))})`),
      min: 1,
    },
    {
      title: "Due",
      lines: due.length
        ? due.map(({ c, d }) => `- ${d < day ? "**overdue** " : ""}${text(c.fields?.what ?? c.title, 120)} (${c.fields?.owner && c.fields.owner !== "user" ? `${text(c.fields.owner, 40)}, ` : ""}${shortDay(d)}) [[${c.id}]]`)
        : ["_Nothing due in the next seven days._"],
      min: 2,
    },
    {
      title: "Recent decisions",
      lines: decisions.map((m) => `- ${text(m.title, 120)} (${shortDay(m.created.slice(0, 10))}) [[${m.id}]]`),
      min: 1,
    },
    {
      title: "Needs review",
      // Counts only: a proposal's or a finding's text is never pinned.
      lines: [
        ...(proposals.length ? [`- ${proposals.length} proposal${proposals.length === 1 ? "" : "s"} waiting in the console`] : []),
        ...[...findingKinds].map(([kind, n]) => `- ${n} lint finding${n === 1 ? "" : "s"}: ${kind}`),
      ],
      min: 2,
    },
  ]
  const header = [`## Dashboard (${shortDay(day)})${latestJournal ? ` · latest journal [[${latestJournal}]]` : ""}`]
  // Fit: each section gets its heading and at least `min` lines, then the
  // rest of the room is shared in order.
  let budget = room - header.length - sections.length * 2
  const take = sections.map((s) => Math.min(s.lines.length, s.min))
  budget -= take.reduce((a, b) => a + b, 0)
  for (let i = 0; budget > 0 && i < sections.length; i += 1) {
    const more = Math.min(budget, sections[i].lines.length - take[i])
    take[i] += more
    budget -= more
  }
  const out = [...header]
  sections.forEach((s, i) => {
    out.push("", `### ${s.title}`)
    out.push(...s.lines.slice(0, take[i]))
    if (s.lines.length > take[i]) out[out.length - 1] += ` (+${s.lines.length - take[i]} more)`
  })
  return out.filter((l, i) => !(l === "" && i === 1))
}
