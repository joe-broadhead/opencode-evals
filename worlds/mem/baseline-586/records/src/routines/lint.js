/**
 * Lint (memory-funnel-v1.md §6, memory-tools-v1.md §8): dangling links,
 * duplicate memories, contradictions, records past `valid_until`, orphan pages
 * and stale commitments. It reports into the dashboard's Needs review and
 * changes nothing itself, except that a contradiction becomes a proposal (the
 * only way a record is marked `contested`).
 */
import { addDays, dueDay } from "./dates.js"
import { similarity, words } from "./extract.js"

const MAX_RECORDS = 5000
const MAX_FINDINGS = 40

/** Every record of the space (current and contested, plus proposals), paged. */
export async function readAll(space, actor, { status } = {}) {
  const out = []
  let cursor = null
  do {
    const page = await space.list({ limit: 200, cursor, full: true, ...(status ? { status } : {}) }, actor)
    out.push(...page.records)
    cursor = page.cursor
  } while (cursor && out.length < MAX_RECORDS)
  return out
}

/** "subject is value": the subject and the value of a simple statement. */
export function claim(text) {
  const m = /^(.{3,80}?)\s+(?:is|are|was|uses?|=|:)\s+(?:now\s+)?(.{1,80})$/i.exec(String(text ?? "").trim().replace(/[.!]+$/, ""))
  if (!m) return null
  return { subject: words(m[1]).join(" "), value: words(m[2]).join(" ") }
}

/**
 * @returns {{findings: Array<{kind: string, id?: string, path?: string, detail: string}>, contradictions: Array<{a: any, b: any}>}}
 */
export function lintRecords(records, { day, tz }) {
  const findings = []
  const contradictions = []
  const byPath = new Map(records.filter((r) => r.path).map((r) => [r.path, r]))
  const byId = new Map(records.map((r) => [r.id, r]))
  const inbound = new Map()
  const live = records.filter((r) => r.status === "current" || r.status === "contested")

  for (const r of live) {
    for (const target of r.links ?? []) {
      inbound.set(target, (inbound.get(target) ?? 0) + 1)
      if (!byPath.has(target) && !byId.has(target)) findings.push({ kind: "dangling link", id: r.id, detail: `${r.path ?? r.title} links to ${target}, which does not exist` })
    }
  }

  const memories = live.filter((r) => r.kind === "memory")
  for (let i = 0; i < memories.length; i += 1) {
    for (let j = i + 1; j < memories.length; j += 1) {
      const a = memories[i]
      const b = memories[j]
      if (a.type !== b.type) continue
      if (similarity(`${a.title} ${a.body}`, `${b.title} ${b.body}`) >= 0.85) {
        findings.push({ kind: "duplicate", id: b.id, detail: `${b.title} repeats ${a.id}` })
        continue
      }
      const ca = claim(a.title)
      const cb = claim(b.title)
      if (ca && cb && ca.subject && ca.subject === cb.subject && ca.value !== cb.value && a.status === "current" && b.status === "current") {
        contradictions.push({ a, b })
        findings.push({ kind: "contradiction", id: b.id, detail: `${b.title} disagrees with ${a.id}` })
      }
    }
    const until = memories[i].fields?.valid_until
    if (until && String(until).slice(0, 10) < day) findings.push({ kind: "expired", id: memories[i].id, detail: `${memories[i].title} was valid until ${String(until).slice(0, 10)}` })
  }

  for (const r of live) {
    if (r.kind !== "page" || ["journal", "index"].includes(r.type)) continue
    if ((inbound.get(r.path) ?? 0) + (inbound.get(r.id) ?? 0) === 0) findings.push({ kind: "orphan page", path: r.path, detail: `nothing links to ${r.path}` })
  }

  for (const c of live.filter((r) => r.kind === "commitment" && r.fields?.state === "open")) {
    const due = dueDay(c.fields?.due, tz)
    if (due && due < addDays(day, -7)) findings.push({ kind: "stale commitment", id: c.id, detail: `${c.fields?.what ?? c.title} was due ${due}` })
    else if (!due && !c.fields?.trigger && c.updated.slice(0, 10) < addDays(day, -30)) findings.push({ kind: "stale commitment", id: c.id, detail: `${c.fields?.what ?? c.title} has no date and has not moved in 30 days` })
  }

  return { findings: findings.slice(0, MAX_FINDINGS), contradictions }
}
