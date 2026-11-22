/**
 * The sequence and the lane cursors (design §10.1, S3a).
 *
 * **Every event gets a monotonic `seq`** in the ingest transaction, and the seq
 * comes from a counter in `meta` (`event_seq`), never from `max(seq) + 1`:
 * retention can delete every event, and a reused seq would sit below a cursor
 * and never be read again.
 *
 * **Enrolment** numbers rows that an earlier build wrote without a seq — the
 * first enable in a space, and a rollback's rows after it (design §12). It
 * numbers them in `ingested_at` order on the `backfill` lane, and it records the
 * moment as the space's cutover watermark, which is what `lanes.js` reads.
 *
 * A cursor is the highest `seq` below which one lane's items from one source are
 * filed (`lane_cursors(lane, source, account, cursor, updated)`), so a batch can
 * carry one source (§10.3) and a lost race can be detected with a
 * compare-and-set (`commit.js`).
 */
import { contentHash, sameHash } from "../events-normalize.js"

export const EVENT_SEQ_KEY = "event_seq"
export const WATERMARK_KEY = "engine_watermark"
/**
 * The `ingested_at` up to which this space has no unnumbered row. Enrolment's
 * probe reads only the rows that arrived after it, so a page pays a range on the
 * `events_ingested` index instead of a scan of the table.
 */
export const ENROLLED_THROUGH_KEY = "engine_seq_checked"

/** The seq counter of one space, read once and written once per transaction. */
export function seqCounter(handle) {
  let value = Number(handle.get("select value from meta where key = ?", EVENT_SEQ_KEY)?.value ?? 0) || 0
  let dirty = false
  return {
    /** The last seq handed out, without taking one. */
    peek() {
      return value
    },
    /** The next seq. The counter is written once, by `save`. */
    take() {
      value += 1
      dirty = true
      return value
    },
    save() {
      if (!dirty) return value
      handle.run("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", EVENT_SEQ_KEY, String(value))
      dirty = false
      return value
    },
  }
}

/**
 * One seq, taken and saved at once (enrolment's own use).
 */
export function nextSeq(handle) {
  const counter = seqCounter(handle)
  const seq = counter.take()
  counter.save()
  return seq
}

/** The space's cutover watermark (ISO), or null before the engine was first on. */
export function watermarkOf(handle) {
  return handle.get("select value from meta where key = ?", WATERMARK_KEY)?.value ?? null
}

/** How many content changes in one day may take a new seq (design §12, decision 8). */
export const REENTRY_CAP = 3

/**
 * The count a row carries when a change **past** the day's cap was not numbered
 * (`REENTRY_CAP + 1`): the mark that says a change was really dropped, so the
 * next day's pass re-queues it and no row with nothing dropped is re-queued
 * (review L2).
 */
export const REENTRY_DROPPED = REENTRY_CAP + 1

/**
 * Re-entry for one updated row: a new seq only when the **content** changed and
 * the day's count is below the cap; a change of labels only keeps the seq, and
 * so does a fourth content change in one day (that one is queued by
 * `requeueCapped` for the next day). The content hash is recorded either way, so
 * the next page is compared against what the row now holds.
 *
 * `stored` is the hash of the row's own content, for a row an older build wrote
 * with no hash at all: the caller computes it from the stored row, so the first
 * update of an enrolled row is compared with what the row holds rather than with
 * nothing.
 *
 * @param {{seq?: number|null, content_hash?: any, reentry_day?: string|null, reentry_count?: number|null}} existing
 * @param {{hash: Buffer|string, day: string, counter?: {take: () => number}, stored?: Buffer|string}} input
 */
export function reentryOf(existing, { hash, day, counter, stored } = {}) {
  const sameDay = existing?.reentry_day === day
  const count = sameDay ? Number(existing?.reentry_count ?? 0) || 0 : 0
  const seq = existing?.seq ?? null
  const previous = stored === undefined ? existing?.content_hash : stored
  const changed = !sameHash(previous, hash)
  if (changed && seq !== null) {
    if (count < REENTRY_CAP) return { seq: counter ? counter.take() : seq, content_hash: hash, reentry_day: day, reentry_count: count + 1 }
    // A change past the cap is not read today: the mark says so, and the next
    // day's first pass gives it one seq so its final content is read.
    return { seq, content_hash: hash, reentry_day: day, reentry_count: REENTRY_DROPPED }
  }
  return { seq, content_hash: hash, reentry_day: day, reentry_count: count }
}

/** A stored JSON column, or its fallback. */
function jsonOf(raw, fallback) {
  if (raw === null || raw === undefined) return fallback
  try {
    return JSON.parse(raw) ?? fallback
  } catch {
    return fallback
  }
}

/**
 * The content hash of a stored row, as `contentHash` computes it for what the
 * ingest keeps: text, title, actors and the facts among the metadata.
 *
 * @param {{title?: string|null, text?: string|null, actors?: string|null, meta?: string|null}} row
 */
export function storedContentHash(row) {
  return contentHash({ title: row?.title ?? null, text: row?.text ?? null, actors: jsonOf(row?.actors, []), meta: jsonOf(row?.meta, null) })
}

/**
 * Number every row that has no seq, in `ingested_at` order, on the `backfill`
 * lane (§12), with the content hash its content already has. The first call
 * records the space's watermark.
 *
 * The probe reads the rows that arrived since the last page this space checked
 * (`engine_seq_checked`), which is one page's worth of index entries; only the
 * first enable in a space walks the whole table once.
 *
 * @param {any} handle the space's handle
 * @param {{now: string, personal: boolean}} input the ingest's ISO time, and
 *   whether the space is personal (a shared space gets a seq and no lane)
 * @returns {{watermark: string, numbered: number}}
 */
export function enroll(handle, { now, personal = false } = {}) {
  let watermark = watermarkOf(handle)
  if (watermark === null) {
    watermark = now
    handle.run("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", WATERMARK_KEY, watermark)
  }
  const through = handle.get("select value from meta where key = ?", ENROLLED_THROUGH_KEY)?.value ?? null
  const fresh = through === null
  const pending = fresh ? Boolean(handle.get("select 1 as hit from events where seq is null limit 1")) : Boolean(handle.get("select 1 as hit from events where seq is null and ingested_at >= ? limit 1", through))
  const counter = seqCounter(handle)
  const day = String(now ?? "").slice(0, 10)
  let numbered = 0
  if (pending) {
    const rows = fresh
      ? handle.all("select id, title, text, actors, meta from events where seq is null order by ingested_at, id")
      : handle.all("select id, title, text, actors, meta from events where seq is null and ingested_at >= ? order by ingested_at, id", through)
    for (const row of rows) {
      handle.run(
        "update events set seq = ?, lane = ?, content_hash = ?, reentry_day = ?, reentry_count = 0 where id = ?",
        counter.take(),
        personal ? "backfill" : null,
        storedContentHash(row),
        day,
        row.id,
      )
      numbered += 1
    }
  }
  counter.save()
  // Everything up to this page's own time is now numbered, so the next probe
  // starts here. It is written whether or not this call numbered anything: the
  // page's own rows carry a seq, and only another build's rows can lack one.
  handle.run("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", ENROLLED_THROUGH_KEY, String(now))
  return { watermark, numbered }
}

/**
 * The rows whose content changed more often than a day allows (§10.1, decision
 * 8): the last change of each sat below its lane's cursor, so the lane would
 * never read what the row now holds. The next day's first ingest gives each one
 * new seq, once, and starts its count again; a later day leaves it alone until
 * three more changes have happened, because the count is below the cap.
 *
 * @param {any} handle
 * @param {{now: string, counter?: {take: () => number, save: () => void}}} input
 *   the ISO time of the pass, and the page's own counter when it has one (so
 *   the two never write `meta.event_seq` from two stale readings)
 * @returns {{requeued: number, lanes: Set<string>}}
 */
export function requeueCapped(handle, { now, counter: given = null } = {}) {
  const day = String(now ?? "").slice(0, 10)
  // `reentry_count >= 3` is spelled out because it is the predicate of the
  // partial index `events_reentry_capped` (schema.js). A comparison against a
  // bound parameter cannot be proven to imply that predicate, so the engine
  // would scan every row of the space on every page (0178); the clause is
  // implied by the one below, which still holds the rule at REENTRY_CAP.
  const rows = handle.all(
    "select id, lane from events where reentry_count >= 3 and reentry_count > ? and reentry_day is not null and reentry_day < ?",
    REENTRY_CAP,
    day,
  )
  const lanes = new Set()
  if (rows.length === 0) return { requeued: 0, lanes }
  const counter = given ?? seqCounter(handle)
  for (const row of rows) {
    handle.run("update events set seq = ?, reentry_day = ?, reentry_count = 0 where id = ?", counter.take(), day, row.id)
    if (row.lane) lanes.add(row.lane)
  }
  if (given === null) counter.save()
  return { requeued: rows.length, lanes }
}

/**
 * One lane's cursor for one source key: the highest seq below which that
 * source's items are filed. 0 when nothing has been filed yet.
 *
 * @param {any} handle
 * @param {{lane: string, source: string, account: string}} key
 */
export function cursorOf(handle, { lane, source, account } = {}) {
  return Number(handle.get("select cursor from lane_cursors where lane = ? and source = ? and account = ?", String(lane ?? ""), String(source ?? ""), String(account ?? ""))?.cursor ?? 0) || 0
}

/** Every cursor of a space, for a status answer. */
export function cursorsAll(handle) {
  return handle.all("select lane, source, account, cursor, updated from lane_cursors order by lane, source, account")
}

/**
 * Move one cursor with a compare-and-set: `update … where cursor = expectFrom`.
 * A first commit (from 0) may insert the row; every later one finds it. False
 * means another writer moved it first, and the caller writes nothing.
 *
 * @returns {boolean} true when this call moved the cursor
 */
export function advanceCursor(handle, { lane, source, account, expectFrom, to, now = new Date().toISOString() } = {}) {
  const key = [String(lane ?? ""), String(source ?? ""), String(account ?? "")]
  const from = Number(expectFrom) || 0
  if (from === 0) {
    const inserted = handle.run(
      "insert into lane_cursors (lane, source, account, cursor, updated) values (?, ?, ?, ?, ?) on conflict(lane, source, account) do nothing",
      key[0],
      key[1],
      key[2],
      Number(to) || 0,
      String(now),
    )
    if (Number(inserted.changes) === 1) return true
  }
  const changed = handle.run("update lane_cursors set cursor = ?, updated = ? where lane = ? and source = ? and account = ? and cursor = ?", Number(to) || 0, String(now), key[0], key[1], key[2], from)
  return Number(changed.changes) === 1
}

/**
 * The lane's unread items above its cursor, oldest seq first: what one batch
 * reads. Retry rows are the other half of a batch and come from `retry.js`,
 * because an item can be due while it is not above the cursor.
 */
export function unreadItems(handle, { lane, source, account, limit = 100 } = {}) {
  const cursor = cursorOf(handle, { lane, source, account })
  return handle.all("select id, seq, source, lane, ingested_at from events where lane = ? and source = ? and account = ? and seq > ? order by seq limit ?", String(lane ?? ""), String(source ?? ""), String(account ?? ""), cursor, Math.max(1, Number(limit) || 100))
}

/** True when one lane still holds an item at or above its cursor (a status read). */
export function pendingWork(handle, lane) {
  return Boolean(
    handle.get(
      `select 1 as hit from events e where e.lane = ? and e.seq is not null
         and e.seq > coalesce((select c.cursor from lane_cursors c where c.lane = e.lane and c.source = e.source and c.account = e.account), 0)
       limit 1`,
      String(lane ?? ""),
    ),
  )
}
