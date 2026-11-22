/**
 * The extract engine's writes (DESIGN-MEMORY-JOBS §6.1, §6.2): proposals into
 * the space, and their withdrawal. Two rules hold here:
 *
 * - **a proposal is written once**: its `fields.job_key` is the same for the
 *   same item on every run, so a re-run, a retried curate or a second host
 *   adds nothing;
 * - **withdrawal retires what it caused**: when a message is deleted at the
 *   source, or an event is cancelled, the proposals that cited it are retired
 *   (never silently kept), and a later run does not propose them again.
 *
 * A forgotten item is not re-proposed: every candidate is checked with the
 * store's own `routineCheck` (the same tombstones the routines use) before it
 * is written, and a blocked one is skipped and counted, never retried.
 */
import { clip } from "../routines/guards.js"

/** The keys of a job's proposals, as they are stored. */
export function existingKeys(handle, jobId) {
  const rows = handle.all("select id, status, json_extract(fields, '$.job_key') as job_key from records where kind = 'proposal' and json_extract(fields, '$.job') = ?", jobId)
  return new Map(rows.filter((row) => typeof row.job_key === "string" && row.job_key).map((row) => [row.job_key, row]))
}

/** The proposals a job wrote that cite one of these events. */
export function proposalsCiting(handle, jobId, eventIds) {
  const ids = [...eventIds]
  if (ids.length === 0) return []
  const marks = ids.map(() => "?").join(", ")
  return handle.all(
    `select id, version, status, json_extract(fields, '$.event_id') as event_id from records
      where kind = 'proposal' and status = 'proposed' and json_extract(fields, '$.job') = ?
        and (json_extract(fields, '$.event_id') in (${marks})
          or exists (select 1 from json_each(fields, '$.events') where value in (${marks})))`,
    jobId,
    ...ids,
    ...ids,
  )
}

/**
 * Write the candidates as proposals: the ones already stored are skipped by
 * key, and the ones a person forgot are skipped by the store's check.
 *
 * @returns {Promise<{written: string[], duplicates: number, forgotten: number, refused: Array<{key: string, why: string}>}>}
 */
export async function writeProposals(space, actor, candidates) {
  const written = []
  let duplicates = 0
  let forgotten = 0
  const refused = []
  if (candidates.length === 0) return { written, duplicates, forgotten, refused }
  // One forgotten check for the whole batch: title and body, exactly as the
  // store would check a routine's items.
  let blocked = new Set()
  if (typeof space.routineCheck === "function") {
    try {
      const answer = await space.routineCheck({ items: candidates.map((candidate) => ({ texts: [candidate.title ?? "", candidate.body ?? ""] })) }, actor)
      blocked = new Set((answer?.blocked ?? []).map((entry) => entry.index))
    } catch (error) {
      // Without the check nothing is written: a forgotten item is never guessed at.
      return { written, duplicates, forgotten: candidates.length, refused: [{ key: null, why: clip(error?.message ?? "the forgotten check failed", 120) }] }
    }
  }
  const keys = await space.jobRead(actor, (handle) => existingKeys(handle, candidates[0].fields.job))
  for (const [index, candidate] of candidates.entries()) {
    const key = candidate.fields?.job_key
    if (blocked.has(index)) {
      forgotten += 1
      continue
    }
    if (typeof key === "string" && keys.has(key)) {
      duplicates += 1
      continue
    }
    try {
      const saved = await space.put({ record: candidate }, actor)
      written.push(saved?.record?.id ?? null)
      if (typeof key === "string") keys.set(key, { id: saved?.record?.id ?? null })
    } catch (error) {
      // `forgotten` is a skip like the check's; anything else is reported.
      if (error?.code === "forgotten") {
        forgotten += 1
        continue
      }
      refused.push({ key: typeof key === "string" ? key : null, why: clip(error?.message ?? String(error), 160) })
    }
  }
  return { written: written.filter(Boolean), duplicates, forgotten, refused }
}

/** The keys of the proposals a meeting page already made, as they are stored. */
export function existingMeetingKeys(handle, meetingId) {
  // By record id, not path: a moved page keeps its proposals (0.11 review, nit).
  const rows = handle.all("select id, status, json_extract(fields, '$.job_key') as job_key from records where kind = 'proposal' and json_extract(fields, '$.meeting_id') = ?", meetingId)
  return new Map(rows.filter((row) => typeof row.job_key === "string" && row.job_key).map((row) => [row.job_key, row]))
}

/**
 * Write one meeting page's candidates as proposals: the ones already stored for
 * that page are skipped by key, and the ones a person forgot are skipped by the
 * store's own check. Nothing here is ever applied: a proposal is a question.
 *
 * @returns {Promise<{written: string[], duplicates: number, forgotten: number, refused: Array<{key: string, why: string}>}>}
 */
export async function writeMeetingProposals(space, actor, meetingId, candidates) {
  const written = []
  let duplicates = 0
  let forgotten = 0
  const refused = []
  if (candidates.length === 0) return { written, duplicates, forgotten, refused }
  let blocked = new Set()
  if (typeof space.routineCheck === "function") {
    try {
      const answer = await space.routineCheck({ items: candidates.map((candidate) => ({ texts: [candidate.title ?? "", candidate.body ?? ""] })) }, actor)
      blocked = new Set((answer?.blocked ?? []).map((entry) => entry.index))
    } catch (error) {
      return { written, duplicates, forgotten: candidates.length, refused: [{ key: null, why: clip(error?.message ?? "the forgotten check failed", 120) }] }
    }
  }
  const keys = await space.jobRead(actor, (handle) => existingMeetingKeys(handle, meetingId))
  for (const [index, candidate] of candidates.entries()) {
    const key = candidate.fields?.job_key
    if (blocked.has(index)) {
      forgotten += 1
      continue
    }
    if (typeof key === "string" && keys.has(key)) {
      duplicates += 1
      continue
    }
    try {
      const saved = await space.put({ record: candidate }, actor)
      written.push(saved?.record?.id ?? null)
      if (typeof key === "string") keys.set(key, { id: saved?.record?.id ?? null })
    } catch (error) {
      if (error?.code === "forgotten") {
        forgotten += 1
        continue
      }
      refused.push({ key: typeof key === "string" ? key : null, why: clip(error?.message ?? String(error), 160) })
    }
  }
  return { written: written.filter(Boolean), duplicates, forgotten, refused }
}

/**
 * Retire the proposals that cited events the source removed: a deleted message
 * or a cancelled meeting takes its proposals with it (§6.2).
 *
 * @returns {Promise<{retired: string[]}>}
 */
export async function retireProposals(space, actor, { jobId, eventIds, reason = "the source withdrew this item" }) {
  const rows = await space.jobRead(actor, (handle) => proposalsCiting(handle, jobId, eventIds))
  const retired = []
  for (const row of rows) {
    try {
      await space.put(
        {
          record: {
            id: row.id,
            base_version: row.version,
            status: "retired",
            fields: { retired_reason: clip(reason, 200), retired_at: new Date().toISOString() },
          },
        },
        actor,
      )
      retired.push(row.id)
    } catch {
      // A proposal another writer changed meanwhile is left as it is; the next
      // curate tries again, and nothing is silently kept.
    }
  }
  return { retired }
}

/** The open proposals one meeting page made, by its record id or its path. */
function proposalsOfMeeting(handle, meetingId, path) {
  const load = (sql, key) =>
    handle.all(sql, key).map((row) => ({
      id: row.id,
      version: row.version,
      record: { id: row.id, version: row.version, title: row.title, body: row.body, fields: parseJson(row.fields) },
    }))
  if (meetingId) return load("select id, version, title, body, fields from records where kind = 'proposal' and status = 'proposed' and json_extract(fields, '$.meeting_id') = ?", meetingId)
  return load("select id, version, title, body, fields from records where kind = 'proposal' and status = 'proposed' and json_extract(fields, '$.meeting') = ?", path)
}

const parseJson = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return {}
  }
}

/**
 * Withdraw the proposals a meeting page made when the page is deleted: a quote
 * outlives nothing (0.11 review, should-fix 1). They are **retired**, not
 * deleted, so the review says what happened, and the content they rest on goes
 * with the page.
 *
 * @returns {Promise<{retired: string[]}>}
 */
export async function retireMeetingProposals(space, actor, { meetingId = null, path = null, reason = "the meeting page was deleted" }) {
  const rows = await space.jobRead(actor, (handle) => proposalsOfMeeting(handle, meetingId, path))
  const retired = []
  for (const row of rows) {
    try {
      // The store retires the proposal and scrubs every version, so neither the
      // row nor `records.history` keeps the words it quoted (0.11 re-review).
      const done = await space.retireMeetingProposal({ id: row.id, reason }, actor)
      if (done?.retired) retired.push(row.id)
    } catch {
      // A proposal another writer changed meanwhile is left as it is; the next
      // pass tries again.
    }
  }
  return { retired }
}
