/**
 * A batch (design §10.3; the plan's §3): one lane's items from one (source,
 * account), read only when their threads are quiet.
 *
 * **One source.** A batch never mixes two source keys: a model call must not
 * carry one source's plugin text beside another's, or a hint written for one
 * could steer the other (`batch-source.test.js`). `buildBatch` refuses a mixed
 * page rather than splitting it silently.
 *
 * **It flushes** at `RECORDS_ROUTINE_BATCH_CHARS` characters (S0's own limit),
 * or when the oldest item reaches the lane's wait: a batch that has waited is
 * read whatever its size, or a quiet source would sit for ever.
 *
 * **A thread is read when it is quiet.** A reply that arrived inside the wait
 * defers its whole thread: the row goes to `lane_retry(kind=deferred)` with
 * `not_before` (its newest message plus the wait), and the lane's cursor still
 * advances past it. The wait is sixty minutes for `general` and ten for `own`,
 * where the person is waiting on the answer.
 */
export const MAX_BATCH_CHARS = 24_000
export const GENERAL_WAIT_MS = 60 * 60_000
export const OWN_WAIT_MS = 10 * 60_000
export const WAITS = Object.freeze({ own: OWN_WAIT_MS, general: GENERAL_WAIT_MS, backfill: GENERAL_WAIT_MS })

/** The lane's wait, in ms. */
export function quietOf({ lane }) {
  return WAITS[lane] ?? GENERAL_WAIT_MS
}

/** One item's own size, as S0 counts it: the text it will put in the call. */
export function itemChars(item) {
  const text = item.segments?.map((segment) => String(segment.text ?? "")).join("\n") ?? String(item.text ?? "")
  return text.length + String(item.title ?? "").length + 40
}

/**
 * Split one lane's rows into the threads that are quiet and the ones that are
 * not.
 *
 * @param {Array<{ref: string, thread: string|null, at: string}>} items
 * @param {{lane: string, now: number}} input
 * @returns {{ready: any[], deferred: Array<{thread: string, notBefore: string}>}}
 */
export function deferThreads(items, { lane, now }) {
  const wait = quietOf({ lane })
  const newest = new Map()
  for (const item of items) {
    const key = item.thread ?? item.ref
    const at = Date.parse(String(item.at ?? ""))
    if (!Number.isFinite(at)) continue
    newest.set(key, Math.max(newest.get(key) ?? 0, at))
  }
  const ready = []
  const deferred = []
  const seen = new Set()
  for (const item of items) {
    const key = item.thread ?? item.ref
    const last = newest.get(key) ?? 0
    if (last !== 0 && now - last < wait) {
      if (!seen.has(key)) {
        seen.add(key)
        deferred.push({ thread: key, notBefore: new Date(last + wait).toISOString() })
      }
      continue
    }
    ready.push(item)
  }
  return { ready, deferred }
}

/**
 * One batch: the quiet items of one lane from one source, cut at the character
 * limit. A single item larger than the limit goes alone, so nothing is dropped.
 *
 * @param {{items: any[], lane: string, source: string, account: string, maxChars?: number, sessionCap?: (units: any[], maxChars: number) => {units: any[], deferred: number}, toUnits?: (items: any[]) => any[]}} input
 */
export function buildBatch({ items, lane, source, account, maxChars = MAX_BATCH_CHARS, sessionCap = null, toUnits = null }) {
  const sources = new Set(items.map((item) => `${item.source}\u0000${item.account ?? ""}`))
  if (sources.size > 1) {
    throw Object.assign(new Error("a batch holds one source; two source keys were given"), { code: "invalid_batch" })
  }
  let units = toUnits ? toUnits(items) : null
  let deferredSessions = 0
  if (units && typeof sessionCap === "function") {
    const capped = sessionCap(units, maxChars)
    units = capped.units
    deferredSessions = capped.deferred
    const kept = new Set(units.flatMap((unit) => (unit.items ?? []).map((item) => item.ref)))
    items = items.filter((item) => kept.has(item.ref))
  }
  const chosen = []
  let chars = 0
  for (const item of items) {
    const size = itemChars(item)
    if (chosen.length > 0 && chars + size > maxChars) break
    chosen.push(item)
    chars += size
  }
  // The units the call carries are the **chosen** items', rebuilt after the cut:
  // a unit built from the whole page put every ready message in the prompt while
  // the batch — and the ledger's count — held only the ones that fitted (review
  // S3d: a 35-item call with a 50,707-character prompt, counted as 19).
  if (toUnits) units = toUnits(chosen)
  const oldestAt = chosen.reduce((oldest, item) => {
    const at = String(item.at ?? item.ingested_at ?? "")
    return oldest === null || at < oldest ? at : oldest
  }, null)
  return { lane, source, account, items: chosen, units, chars, oldestAt, hi: chosen.at(-1)?.seq ?? 0, deferredSessions }
}

/**
 * The items that fit one call's character budget: in the order given (a retry set
 * is oldest-due first), and a single item larger than the budget goes alone so
 * nothing is dropped. The rest are the caller's to read next pass.
 *
 * @param {any[]} items
 * @param {number} [maxChars]
 * @returns {{items: any[], chars: number}}
 */
export function fitItems(items, maxChars = MAX_BATCH_CHARS) {
  const chosen = []
  let chars = 0
  for (const item of items) {
    const size = itemChars(item)
    if (chosen.length > 0 && chars + size > maxChars) break
    chosen.push(item)
    chars += size
  }
  return { items: chosen, chars }
}

/** True when a batch must flush now: it is full, or its oldest item has waited long enough. */
export function dueNow({ batch, lane, now, maxChars = MAX_BATCH_CHARS }) {
  if (batch.items.length === 0) return false
  if (batch.chars >= maxChars) return true
  const oldest = Date.parse(String(batch.oldestAt ?? ""))
  return Number.isFinite(oldest) && now - oldest >= quietOf({ lane })
}
