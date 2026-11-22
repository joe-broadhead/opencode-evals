/**
 * Page writes (docs/design/memory-routines-v1.md §4.3, scale H-B). A projected
 * page is rebuilt at most once per 15 minutes, or at the end of a batch, and a
 * version is written only when the content really changed. Routine-written
 * versions are compacted to the last 10 plus one a day for 30 days, so a page
 * that is rebuilt all day does not grow without bound.
 */
import { sha256 } from "../ids.js"
import { claimsEnabled } from "./flag.js"

export const PAGE_INTERVAL_MS = 15 * 60_000

/**
 * @param {{handle: any, write: (path: string, body: string) => any, now?: () => Date,
 *   env?: Record<string, string | undefined>, intervalMs?: number}} input
 * @returns {PageWriter | null}
 */
export function createPageWriter({ handle, write, now = () => new Date(), env = process.env, intervalMs = PAGE_INTERVAL_MS } = {}) {
  if (!claimsEnabled(env)) return null
  return new PageWriter({ handle, write, now, intervalMs })
}

export class PageWriter {
  #handle
  #write
  #now
  #interval
  #pending = new Map()

  constructor({ handle, write, now, intervalMs }) {
    this.#handle = handle
    this.#write = write
    this.#now = now
    this.#interval = intervalMs
  }

  /**
   * Ask for a page's current content; a later request for the same page
   * replaces it. With a record id, the write also compacts that page's
   * routine-written versions.
   */
  request(path, body, { recordId = null } = {}) {
    this.#pending.set(String(path), { body: String(body), recordId })
  }

  /** The pages waiting for a write, for a caller's report. */
  get pending() {
    return [...this.#pending.keys()]
  }

  /**
   * Write what is due. The 15-minute bound holds at the end of a batch too: a
   * page is never written twice inside it (review M5). A page whose content is
   * unchanged is skipped and drops out of the queue.
   */
  async flush() {
    const at = this.#now()
    const written = []
    const deferred = []
    const skipped = []
    const compacted = []
    for (const [path, item] of [...this.#pending]) {
      const row = this.#handle.get("select at, digest from claim_page_writes where path = ?", path)
      if (row && at.getTime() - new Date(row.at).getTime() < this.#interval) {
        deferred.push(path)
        continue
      }
      const digest = sha256(item.body)
      if (row && row.digest === digest) {
        skipped.push(path)
        this.#pending.delete(path)
        continue
      }
      await this.#write(path, item.body)
      this.#handle.run(
        `insert into claim_page_writes (path, at, digest) values (?, ?, ?)
         on conflict(path) do update set at = excluded.at, digest = excluded.digest`,
        path,
        at.toISOString(),
        digest,
      )
      if (item.recordId) {
        compacted.push({ path, ...compactRoutineVersions(this.#handle, { recordId: item.recordId, now: at }) })
      }
      written.push(path)
      this.#pending.delete(path)
    }
    return { written, deferred, skipped, compacted }
  }
}

/**
 * Compact one page's routine-written versions: keep the newest 10, and one a
 * day for the last 30 days. A version a person wrote is never removed.
 */
export function compactRoutineVersions(handle, { recordId, now = new Date(), keep = 10, days = 30 } = {}) {
  const rows = handle.all("select version, snapshot, saved from versions where record_id = ? order by version desc", String(recordId))
  if (rows.length <= keep) return { removed: 0, kept: rows.length }
  const cutoff = now.getTime() - days * 86_400_000
  const seenDays = new Set(rows.slice(0, keep).map((row) => String(row.saved ?? "").slice(0, 10)))
  const remove = []
  rows.forEach((row, index) => {
    if (index < keep) return
    if (!routineWritten(row.snapshot)) return
    const day = String(row.saved ?? "").slice(0, 10)
    const recent = new Date(row.saved).getTime() >= cutoff
    if (recent && !seenDays.has(day)) {
      seenDays.add(day)
      return
    }
    remove.push(row.version)
  })
  handle.tx(() => {
    for (const version of remove) handle.run("delete from versions where record_id = ? and version = ?", String(recordId), version)
  })
  return { removed: remove.length, kept: rows.length - remove.length }
}

function routineWritten(snapshot) {
  try {
    const record = JSON.parse(snapshot)
    return Boolean(record?.source?.routine) && record?.stated_by !== "person"
  } catch {
    return false
  }
}
