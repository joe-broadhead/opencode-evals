/**
 * The cell's metrics and pages (design §10.5; plan §4): the list a person or an
 * operator reads, from the ready index and the engine's own counters, at
 * `/metrics` and in `routines.status`.
 *
 * A **page** is what wakes somebody: the earliest deadline under 72 hours; no
 * lease completed in 15 minutes with work pending; a breaker open for 30 minutes;
 * the service cap spent before 18:00 UTC; a canary that missed its target; and
 * the disk at 70%. One condition, one page, each with the numbers that fired it.
 */
import fs from "node:fs"

export const PAGE_DEADLINE_MS = 72 * 3_600_000
export const PAGE_IDLE_LEASE_MS = 15 * 60_000
export const PAGE_BREAKER_MS = 30 * 60_000
export const PAGE_DISK_RATIO = 0.7
export const PAGE_CAP_HOUR_UTC = 18

/**
 * The disk's used share, from `fs.statfs`, or null when the platform cannot say.
 *
 * @param {string} dir
 * @param {{statfs?: (dir: string) => any}} [options]
 */
export function diskUsed(dir, { statfs = fs.statfsSync } = {}) {
  try {
    // `fs.statfs` is the callback form: calling it without one throws and the
    // alert could never fire (review M2). The synchronous call answers numbers.
    const stats = statfs(dir)
    const total = Number(stats.blocks) * Number(stats.bsize)
    const free = Number(stats.bavail) * Number(stats.bsize)
    if (!total || !Number.isFinite(total)) return null
    return { ratio: 1 - free / total, used: total - free, total }
  } catch {
    return null
  }
}

/**
 * The §10.5 list from what the caller has: the ready index, the engine's
 * counters, the guard's breakers, the tiers' wait and pause, the disk and the
 * event loop's own lag.
 */
export function collectMetrics({ ready = [], counters = {}, breaks = {}, disk = null, eventLoop = null, now = Date.now(), lease = null, canary = null, spend = null } = {}) {
  const pending = ready.reduce((sum, entry) => sum + (Number(entry.pending_tokens) || 0), 0)
  const deadlines = ready.map((entry) => entry.deadline).filter((value) => typeof value === "number")
  return {
    at: new Date(now).toISOString(),
    spaces: { ready: ready.length, pending_tokens: pending, earliest_deadline: deadlines.length ? Math.min(...deadlines) : null },
    lanes: counters.lanes ?? {},
    retry: counters.retry ?? null,
    leases: { last_completed: lease?.lastCompleted ?? null, age_ms: lease?.lastCompleted ? now - lease.lastCompleted : null, in_flight: lease?.inFlight ?? 0 },
    breakers: breaks,
    spend: spend ?? null,
    canary: canary ?? null,
    event_loop: eventLoop ? { lag_ms: eventLoop } : null,
    disk: disk ? { ratio: disk.ratio, used: disk.used, total: disk.total } : null,
    engine: counters.engine ?? null,
  }
}

/**
 * One page per condition that holds, each naming the numbers that fired it.
 *
 * @param {ReturnType<typeof collectMetrics>} metrics
 * @param {{now?: number}} [options]
 */
export function pages(metrics, { now = Date.parse(metrics.at ?? new Date().toISOString()) } = {}) {
  const out = []
  const earliest = metrics.spaces?.earliest_deadline
  if (typeof earliest === "number" && earliest - now < PAGE_DEADLINE_MS) out.push({ condition: "deadline", severity: "page", message: `a lane's earliest deadline is ${Math.round((earliest - now) / 3_600_000)} hours away`, deadline: earliest })
  const work = Number(metrics.spaces?.pending_tokens) || 0
  const age = metrics.leases?.age_ms
  if (work > 0 && (age === null || age === undefined || age > PAGE_IDLE_LEASE_MS)) out.push({ condition: "no_lease", severity: "page", message: `work waits and no lease has completed in ${age === null || age === undefined ? "this process" : `${Math.round(age / 60_000)} minutes`}`, pending_tokens: work })
  for (const [tier, state] of Object.entries(metrics.breakers ?? {})) {
    // A breaker pages once it **has been open** for half an hour (review L), not
    // on the time it has left: a breaker with two minutes left is about to close.
    const opened = typeof state === "object" && state ? Date.parse(state.opened_at ?? "") : Number.NaN
    const until = typeof state === "object" && state ? state.until : state
    const closes = typeof until === "string" ? Date.parse(until) : Number(until)
    if (Number.isFinite(opened) && Number.isFinite(closes) && closes > now && now - opened >= PAGE_BREAKER_MS) {
      out.push({ condition: "breaker", severity: "page", tier, message: `the ${tier} breaker has been open for ${Math.round((now - opened) / 60_000)} minutes`, until, opened_at: state.opened_at })
    }
  }
  if (metrics.spend?.cap && Number(metrics.spend.spent) >= Number(metrics.spend.cap) && new Date(now).getUTCHours() < PAGE_CAP_HOUR_UTC) {
    out.push({ condition: "service_cap", severity: "page", message: `the service cap is spent before ${PAGE_CAP_HOUR_UTC}:00 UTC`, spent: metrics.spend.spent, cap: metrics.spend.cap })
  }
  if (metrics.canary?.page) out.push({ condition: "canary", severity: "page", ...metrics.canary.page })
  if (metrics.disk && metrics.disk.ratio >= PAGE_DISK_RATIO) out.push({ condition: "disk", severity: "page", message: `the disk is ${Math.round(metrics.disk.ratio * 100)}% used`, ratio: metrics.disk.ratio })
  return out
}
