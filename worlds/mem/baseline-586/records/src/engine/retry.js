/**
 * The retry set (design §10.1, S3a): a small, bounded table of items a lane must
 * come back to.
 *
 * - `failed`: the model did not answer for this item; attempts drive the back-off.
 * - `deferred`: its thread was not quiet yet, so the cursor could still move.
 * - `held`: a claim the trait gate holds. **S1's `trait_holds` is that row**, and
 *   it is never copied here: `retrySize` counts it as `held`.
 *
 * At `RETRY_CAP` rows a lane stops advancing, visibly (`engine.status`), rather
 * than growing the table past what one space can pay to retry.
 */
import { EngineError } from "./errors.js"

/** At most this many rows per space, `trait_holds` counted too. */
export const RETRY_CAP = 2000

/** The three kinds, and nothing else. */
export const RETRY_KINDS = Object.freeze(["failed", "deferred", "held"])

/** How many rows the retry set holds: its own, and S1's holds. */
export function retrySize(handle) {
  const rows = Number(handle.get("select count(*) as n from lane_retry")?.n) || 0
  const holds = Number(handle.get("select count(*) as n from trait_holds")?.n) || 0
  return { rows, holds, total: rows + holds }
}

/** The retry set's state for a status answer: the cap, the counts, and whether it is full. */
export function retryStatus(handle) {
  const size = retrySize(handle)
  return { cap: RETRY_CAP, ...size, full: size.total >= RETRY_CAP }
}

/** True when the set is at its cap, so a lane may not advance. */
export function retryAtCap(handle) {
  return retrySize(handle).total >= RETRY_CAP
}

/**
 * Add one item to the retry set, or count another attempt on the item already
 * there.
 *
 * @param {any} handle the space's handle (or a transaction on it)
 * @param {{eventId: string, lane: string, source: string, account: string, kind?: string, attempts?: number, notBefore?: string|null, reason?: string, now?: string}} input
 */
export function retryAdd(handle, { eventId, lane, source, account, kind = "failed", attempts = 1, notBefore = null, reason = "", now = new Date().toISOString() } = {}) {
  if (!RETRY_KINDS.includes(kind)) {
    throw new EngineError("invalid_retry", `"${kind}" is not a retry kind.`, `Send a kind as ${RETRY_KINDS.join(", ")}.`, { status: 400 })
  }
  if (typeof eventId !== "string" || eventId === "") {
    throw new EngineError("invalid_retry", "A retry row names the event it is about.", "Send eventId as the event's id (evt_…).", { status: 400 })
  }
  const at = String(now ?? "").slice(0, 40)
  handle.run(
    `insert into lane_retry (event_id, lane, source, account, kind, attempts, not_before, reason, created) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(event_id) do update set lane = excluded.lane, source = excluded.source, account = excluded.account, kind = excluded.kind,
       attempts = lane_retry.attempts + 1, not_before = excluded.not_before, reason = excluded.reason`,
    eventId,
    String(lane ?? ""),
    String(source ?? ""),
    String(account ?? ""),
    kind,
    Math.max(0, Number(attempts) || 0),
    notBefore === null || notBefore === undefined ? null : String(notBefore),
    String(reason ?? "").slice(0, 300),
    at,
  )
}

/** The item was read: its retry row goes. */
export function retryClear(handle, eventId) {
  return Number(handle.run("delete from lane_retry where event_id = ?", eventId).changes) || 0
}

/** How many attempts a failed item gets before it is set aside (§10.1). */
export const FAILED_MAX = 3

/**
 * The back-off after an attempt: one minute, then five. Attempts drive the wait
 * only, and only a real call that failed counts one.
 *
 * @param {number} attempts how many attempts the item has had
 */
export function backoffMs(attempts) {
  const had = Math.max(1, Number(attempts) || 1)
  return had === 1 ? 60_000 : had === 2 ? 300_000 : 900_000
}

/**
 * The retry rows one lane may take now: `not_before` is null or past, and a
 * failed item has not used all its attempts. A row at `FAILED_MAX` attempts is
 * set aside: it stays, with its reason, and is never due again.
 */
export function retryDue(handle, { lane, source, account, now = new Date().toISOString(), limit = 100 } = {}) {
  return handle.all(
    `select event_id, lane, source, account, kind, attempts, not_before, reason, created from lane_retry
      where lane = ? and source = ? and account = ?
        and (not_before is null or not_before <= ?)
        and not (kind = 'failed' and attempts >= ?)
      order by created, event_id limit ?`,
    String(lane ?? ""),
    String(source ?? ""),
    String(account ?? ""),
    String(now),
    FAILED_MAX,
    Math.max(1, Number(limit) || 100),
  )
}

/** Every due retry row of a space, whatever its lane, for the scheduler. */
export function retryDueAll(handle, { now = new Date().toISOString(), limit = 200 } = {}) {
  return handle.all(
    `select event_id, lane, source, account, kind, attempts, not_before, reason, created from lane_retry
      where (not_before is null or not_before <= ?) and not (kind = 'failed' and attempts >= ?) and kind <> 'held'
      order by not_before, created, event_id limit ?`,
    String(now),
    FAILED_MAX,
    Math.max(1, Number(limit) || 200),
  )
}

/** One retry row, by the event it is about. */
export function retryOf(handle, eventId) {
  return handle.get("select event_id, lane, source, account, kind, attempts, not_before, reason, created from lane_retry where event_id = ?", String(eventId ?? "")) ?? null
}

/** Every retry row, for a status answer that names them. */
export function retryRows(handle, { lane = null, limit = 200 } = {}) {
  return lane === null
    ? handle.all("select event_id, lane, source, account, kind, attempts, not_before, reason, created from lane_retry order by created, event_id limit ?", Math.max(1, Number(limit) || 200))
    : handle.all("select event_id, lane, source, account, kind, attempts, not_before, reason, created from lane_retry where lane = ? order by created, event_id limit ?", lane, Math.max(1, Number(limit) || 200))
}
