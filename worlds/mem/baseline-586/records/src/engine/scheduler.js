/**
 * The scheduler (design §10.2; the plan's §3): which space and lane a slot is
 * spent on, from the ready index alone.
 *
 * **A deadline** is the earlier of two things: the oldest item's expiry
 * (`ingested_at` plus the retention window minus three days, so there is time to
 * read it before it goes) and the lane's target — fifteen minutes for `own`, two
 * hours for `general`, and nothing for `backfill`, which waits for its expiry.
 * A batch is read earliest deadline first, because that is the only order that
 * can never lose an item to retention.
 *
 * **Fair share** is deficit round robin in estimated tokens: a space's every
 * slot adds its batch's estimate to its credit, and the space with the most
 * credit goes next, so one heavy space cannot take the cell's day from fifty
 * light ones. Every space has weight 1 until S5.
 *
 * **The own reserve** is 30% of the slots. Every third slot in ten goes to an
 * `own` candidate when there is one, so a busy `general` lane can never hold the
 * person's own mail behind it.
 */
export const LANE_TARGETS = Object.freeze({ own: 15 * 60_000, general: 2 * 60 * 60_000, backfill: null })
/** How long before an event's expiry its lane must read it. */
export const EXPIRY_MARGIN_MS = 3 * 86_400_000
export const DAY_MS = 86_400_000
export const OWN_RESERVE = 0.3

/**
 * One candidate's deadline, in ms since the epoch.
 *
 * @param {{ingestedAt: string|number, lane: string, retentionDays: number, now: number, targets?: object}} input
 */
export function deadlineOf({ ingestedAt, lane, retentionDays = 30, now, targets = LANE_TARGETS }) {
  const at = typeof ingestedAt === "number" ? ingestedAt : Date.parse(String(ingestedAt))
  const expiry = (Number.isFinite(at) ? at : now) + retentionDays * DAY_MS - EXPIRY_MARGIN_MS
  const target = targets[lane]
  return target === null || target === undefined ? expiry : Math.min(expiry, now + target)
}

/**
 * A scheduler with its own round-robin state. One per engine (`createEngine`),
 * so a tick and a manual pass share the same fairness.
 *
 * @param {{now?: () => number, retentionDays?: number, targets?: object}} [options]
 */
export function createScheduler({ now = () => Date.now(), retentionDays = 30, targets = LANE_TARGETS } = {}) {
  /** space → the estimated tokens its slots have spent. */
  const spent = new Map()
  let slot = 0
  const at = (candidate) => deadlineOf({ ingestedAt: candidate.oldestAt, lane: candidate.lane, retentionDays, now: now(), targets })
  const score = (candidate) => (spent.get(candidate.space) ?? 0) / (Number(candidate.weight) || 1)
  const spend = (candidate) => spent.set(candidate.space, (spent.get(candidate.space) ?? 0) + Math.max(1, Number(candidate.tokens) || 1))
  /** The least-spent space first, then the earliest deadline, then the id. */
  const best = (candidates) => {
    let chosen = null
    for (const candidate of candidates) {
      if (chosen === null) {
        chosen = candidate
        continue
      }
      const mine = score(candidate)
      const theirs = score(chosen)
      if (mine < theirs - 1e-9) chosen = candidate
      else if (Math.abs(mine - theirs) <= 1e-9) {
        const a = at(candidate)
        const b = at(chosen)
        if (a < b || (a === b && candidate.space < chosen.space)) chosen = candidate
      }
    }
    return chosen
  }
  const scheduler = {
    /**
     * The whole order for `slots` slots: the own reserve first, then fair share
     * with the earliest deadline as the tie-break. Read-only: it spends nothing,
     * so a caller that orders and then picks does not pay twice.
     */
    order(candidates, { slots = 10, ownReserve = OWN_RESERVE } = {}) {
      const out = []
      const left = [...candidates]
      const own = candidates.filter((candidate) => candidate.lane === "own")
      const reserved = ownReserve > 0 ? Math.round(slots * ownReserve) : 0
      for (let n = 0; n < slots && left.length > 0; n += 1) {
        const pool = n < reserved && own.length > 0 ? left.filter((candidate) => candidate.lane === "own") : left
        if (pool.length === 0) break
        const chosen = best(pool)
        out.push(chosen)
        left.splice(left.indexOf(chosen), 1)
      }
      return out
    },
    /** One slot: the fair share's choice, with the own reserve in front of it. */
    pick(candidates, { slots = 10, ownReserve = OWN_RESERVE } = {}) {
      if (candidates.length === 0) return null
      const own = candidates.filter((candidate) => candidate.lane === "own")
      const reserved = ownReserve > 0 && own.length > 0 && (slot % slots) < Math.round(slots * ownReserve)
      const chosen = best(reserved ? own : candidates)
      slot += 1
      if (chosen) spend(chosen)
      return chosen
    },
    /** What each space has spent, for a status answer. */
    credits() {
      return Object.fromEntries([...spent.entries()].map(([space, value]) => [space, Math.round(value)]))
    },
  }
  return scheduler
}
