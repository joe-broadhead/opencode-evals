/**
 * Weekly and monthly rollups (memory-funnel-v1.md §6): `journal/YYYY-wNN` and
 * `journal/YYYY-MM`, built from the dailies with no model. They keep each
 * daily bullet's own citation and add a link to the daily it came from: what
 * moved, the decisions, commitments opened and closed, open loops, and the
 * people seen most.
 */
import { isoWeek, longDay, monthDays, monthName, monthPath, weekDays, weekPath } from "./dates.js"
import { cleanLine } from "./guards.js"

/** Bullets of a page by section: {"Decisions": [...], "Commitments/New": [...], "By project/[[projects/x|X]]": [...]}. */
export function sectionsOf(body) {
  const out = {}
  let h2 = ""
  let h3 = ""
  for (const line of String(body ?? "").split("\n")) {
    if (/^## /.test(line)) {
      h2 = line.slice(3).trim()
      h3 = ""
    } else if (/^### /.test(line)) h3 = line.slice(4).trim()
    else if (/^- /.test(line)) {
      const key = h3 ? `${h2}/${h3}` : h2
      ;(out[key] ??= []).push(line)
    }
  }
  return out
}

/**
 * @param {{kind: "weekly"|"monthly", day: string, journals: any[], openCommitments: any[], version: string, runId: string}} input
 * @returns {{path: string, title: string, body: string, fields: object}}
 */
export function renderRollup({ kind, day, journals, openCommitments, version, runId }) {
  const days = kind === "weekly" ? weekDays(day) : monthDays(day)
  const path = kind === "weekly" ? weekPath(day) : monthPath(day)
  const { year, week } = isoWeek(day)
  const title = kind === "weekly" ? `Week ${week}, ${year}` : monthName(day)
  const byDay = journals.filter((j) => j.fields?.date && days.includes(j.fields.date)).sort((a, b) => (a.fields.date < b.fields.date ? -1 : 1))
  const L = [`# ${title} (${longDay(days[0])} to ${longDay(days[days.length - 1])})`, ""]
  const projects = new Map()
  const decisions = []
  const opened = []
  const closed = []
  const people = new Map()
  for (const j of byDay) {
    const s = sectionsOf(j.body)
    const tag = ` [[${j.path}]]`
    for (const [key, lines] of Object.entries(s)) {
      if (key.startsWith("By project/")) {
        const p = key.slice("By project/".length)
        projects.set(p, [...(projects.get(p) ?? []), ...lines.map((l) => l + tag)])
      }
    }
    decisions.push(...(s.Decisions ?? []).map((l) => l + tag))
    opened.push(...(s["Commitments/New"] ?? []).map((l) => l + tag))
    closed.push(...(s["Commitments/Closed"] ?? []).map((l) => l + tag))
    for (const line of s.People ?? []) {
      const m = /\[\[(people\/[^\]|]+)(?:\|([^\]]*))?\]\]/.exec(line)
      if (!m) continue
      const entry = people.get(m[1]) ?? { path: m[1], label: m[2] ?? null, days: 0, last: j.path }
      entry.days += 1
      entry.last = j.path
      people.set(m[1], entry)
    }
  }
  L.push("## Summary", "", `${byDay.length} daily journals; ${decisions.length} decisions; ${opened.length} commitments opened and ${closed.length} closed.`, "")
  if (projects.size) {
    L.push("## What moved", "")
    for (const [p, lines] of projects) L.push(`### ${p}`, "", ...lines.slice(0, kind === "weekly" ? 10 : 20), "")
  }
  if (decisions.length) L.push("## Decisions", "", ...decisions, "")
  if (opened.length || closed.length) {
    L.push("## Commitments", "")
    if (opened.length) L.push("### Opened", "", ...opened, "")
    if (closed.length) L.push("### Closed", "", ...closed, "")
  }
  const loops = openCommitments.filter((c) => c.fields?.state === "open")
  if (loops.length) {
    L.push("## Open loops", "")
    for (const c of loops.slice(0, 20)) L.push(`- ${cleanLine(c.fields?.what ?? c.title, 140)}${c.fields?.due ? ` (due ${String(c.fields.due).slice(0, 10)})` : ""} [[${c.id}]]`)
    L.push("")
  }
  const top = [...people.values()].sort((a, b) => b.days - a.days || (a.path < b.path ? -1 : 1)).slice(0, 8)
  if (top.length) {
    L.push("## People seen most", "")
    for (const p of top) L.push(`- [[${p.path}${p.label ? `|${p.label}` : ""}]]: ${p.days} ${p.days === 1 ? "day" : "days"} [[${p.last}]]`)
    L.push("")
  }
  L.push("---", `_${version} · ${byDay.length} journals · no model · run ${runId}_`)
  return {
    path,
    title,
    body: L.join("\n"),
    fields: { date: days[0], period: kind === "weekly" ? "week" : "month", routine: version, edited: false, sources: { journals: byDay.length } },
  }
}
