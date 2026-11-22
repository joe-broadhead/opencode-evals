/**
 * The batch commit (design §10.1 and scale L1; the plan's §2, "the S3b
 * interface"). One transaction moves the cursor and writes everything the batch
 * produced: S2's claims through `file(tx)`, the lane ledger's line, and the retry
 * rows it left behind.
 *
 * The cursor moves with a compare-and-set, so two workers that read the same
 * cursor cannot both commit: the loser throws and writes nothing at all. S2's
 * `ClaimsStore.file` is synchronous on the handle it is given, so a claim, a
 * projection line, the ledger and the cursor are one transaction.
 */
import { ulid } from "../ids.js"
import { advanceCursor } from "./cursors.js"
import { EngineError, cursorRace, retryCap } from "./errors.js"
import { LANES } from "./lanes.js"
import { retryAdd, retryStatus } from "./retry.js"

/**
 * @param {any} handle the space's handle
 * @param {{lane: string, source: string, account: string, expectFrom: number, to: number,
 *   file?: ((tx: any) => void) | null, ledger?: Record<string, unknown> | null,
 *   retry?: Array<Record<string, unknown>>, now?: string | null}} batch
 * @returns {{lane: string, source: string, account: string, from: number, to: number}}
 */
export function commitBatch(handle, { lane, source, account, expectFrom, to, file = null, ledger = null, retry = [], now = null } = {}) {
  if (!LANES.includes(lane)) {
    throw new EngineError("invalid_commit", `"${lane}" is not a lane.`, `Send a lane as ${LANES.join(", ")}.`, { status: 400 })
  }
  const from = Number(expectFrom)
  const target = Number(to)
  if (!Number.isInteger(from) || from < 0 || !Number.isInteger(target) || target < from) {
    throw new EngineError("invalid_commit", `A commit moves a cursor forward: expectFrom ${JSON.stringify(expectFrom)}, to ${JSON.stringify(to)}.`, "Send both as whole seqs, with to at or above expectFrom.")
  }
  if (typeof source !== "string" || source === "" || typeof account !== "string") {
    throw new EngineError("invalid_commit", "A commit names the source key it filed.", "Send source and account as the binding's.", { status: 400 })
  }
  const at = now ?? new Date().toISOString()
  // A savepoint, not the store's transaction: the batch runs inside a lease's own
  // transaction (`handle.tx`), and a nested `tx` cannot roll back alone, so a
  // throw inside `file` would leave the cursor moved. A savepoint is atomic
  // wherever it runs (review L2).
  const scoped = typeof handle.savepoint === "function" ? handle.savepoint.bind(handle) : handle.tx.bind(handle)
  return scoped(() => {
    // At the cap the lane stops advancing (§10.1), by the same rule a status
    // answer reports, so a full retry set is refused here and nowhere else.
    if (target > from) {
      const size = retryStatus(handle)
      if (size.full) throw retryCap(lane, size.total, size.cap)
    }
    // The compare-and-set runs even when the batch moves nothing: a lease that
    // found no new items still learned it was reading the current cursor, and a
    // stale reader must be refused rather than write a ledger line and a retry
    // row against a lane it no longer owns (review L2).
    if (!advanceCursor(handle, { lane, source, account, expectFrom: from, to: target, now: at })) throw cursorRace(lane, source, account)
    // The batch's own writes: S2's claims, and whatever S3b adds beside them.
    if (typeof file === "function") file(handle)
    if (ledger && typeof ledger === "object") {
      handle.run(
        `insert into lane_ledger (id, at, lane, source, account, lo, hi, items, tier, tokens, calls, outcome, digest)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        String(ledger.id ?? ulid()),
        String(ledger.at ?? at),
        String(ledger.lane ?? lane),
        String(ledger.source ?? source),
        String(ledger.account ?? account),
        Number.isInteger(ledger.lo) ? ledger.lo : from,
        Number.isInteger(ledger.hi) ? ledger.hi : target,
        Number(ledger.items ?? 0) || 0,
        ledger.tier === undefined || ledger.tier === null ? null : String(ledger.tier),
        Number(ledger.tokens ?? 0) || 0,
        Number(ledger.calls ?? 0) || 0,
        String(ledger.outcome ?? ""),
        ledger.digest === undefined || ledger.digest === null ? null : String(ledger.digest),
      )
    }
    for (const entry of Array.isArray(retry) ? retry : []) {
      retryAdd(handle, { lane, source, account, now: at, ...entry })
    }
    return { lane, source, account, from, to: target }
  })
}
