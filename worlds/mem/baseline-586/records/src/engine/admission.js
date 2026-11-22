/**
 * Admission (design §10.5; plan §4): a cell admits spaces up to its capacity, and
 * a bind's backfill window is narrowed when the free backfill capacity over the
 * retention window cannot hold its estimate.
 *
 * Nothing here reads a space file: the cohort is a list of ids, and *active* is
 * the count the ready index names.
 */
export const BACKFILL_SHARE = 0.5

/**
 * Which of a cohort a cell admits, and which wait.
 *
 * @param {{cohort: string[], active: number, capacity: number, enabled?: string[]}} input
 *   `enabled` is who is already active; the rest are refused in cohort order.
 */
export function admit({ cohort = [], active = 0, capacity = 0, enabled = [] } = {}) {
  const known = new Set(enabled)
  // `active` already counts the spaces that are on, so only the new ones take room.
  let room = Math.max(0, Number(capacity) - Number(active))
  const admitted = []
  const refused = []
  for (const space of cohort) {
    if (known.has(space)) {
      admitted.push(space)
      continue
    }
    if (room > 0) {
      admitted.push(space)
      room -= 1
      continue
    }
    refused.push({ space, reason: "capacity", next: "Wait for a space to leave the cohort, or raise the cell's capacity." })
  }
  return { admitted, refused }
}

/**
 * The backfill window a bind may have (design §10.5, plan §4): a window is
 * narrowed when free backfill capacity × 0.5 × retention is under the estimate,
 * and refused when even a single day's share is under it. The answer is in days.
 *
 * @param {{freeBackfillCapacity: number, retentionDays: number, estimate: number, share?: number}} input
 */
export function backfillWindowDays({ freeBackfillCapacity = 0, retentionDays = 30, estimate = 1, share = BACKFILL_SHARE } = {}) {
  const budget = Math.max(0, Number(freeBackfillCapacity) || 0) * Math.max(0, share) * Math.max(0, Number(retentionDays) || 0)
  const wanted = Math.max(1, Number(estimate) || 1)
  if (budget <= 0 || budget < wanted / Math.max(1, Number(retentionDays) || 1)) return { days: 0, refused: true, reason: "backfill_capacity", budget }
  const days = Math.max(1, Math.min(Math.max(1, Number(retentionDays) || 1), Math.floor(budget / wanted)))
  return { days, refused: false, budget }
}
