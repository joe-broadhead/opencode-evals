/**
 * The engine (S3a, docs/design/s3-engine-plan.md §1–2). A leaf beside the
 * routines: `records/src/server.js` loads it with the **same** `guard` object,
 * so the breaker and the cell's daily spend are one fact.
 *
 * With `RECORDS_ENGINE=off` it does nothing: no marker, no lease, no write, so
 * production is unchanged. `ingest` numbers events, hashes their content and
 * assigns their lane inside the ingest transaction with no model call at all.
 *
 * S3b adds the scheduler, the pools and the leases; S3c the breakers, the
 * metrics and the canary. This module is where those hang their state and their
 * status, and the lane rule, the cursors, the retry set, the ready index and the
 * batch commit below are the part that exists now.
 */
import { cursorsAll, pendingWork } from "./cursors.js"
import { cohortOf, engineMode, engineOn, shadowFor } from "./flag.js"
import { createRunner } from "./runner.js"
import { createCanary } from "./canary.js"
import { createCellLedger, fairShareCap } from "./cell-ledger.js"
import { collectMetrics, diskUsed, pages } from "./metrics.js"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { LANES, laneOf, openLane } from "./lanes.js"
import { clearReady, readyIndex, touchReady } from "./ready.js"
import { retryStatus } from "./retry.js"

export { ENGINE_ENV, ENGINE_MODES, ENGINE_SPACES_ENV, cohortOf, engineMode, engineOn, shadowFor } from "./flag.js"
export { LANES, laneContext, laneOf, openLane } from "./lanes.js"
export { EVENT_SEQ_KEY, WATERMARK_KEY, REENTRY_CAP, advanceCursor, cursorOf, cursorsAll, enroll, nextSeq, pendingWork, reentryOf, seqCounter, unreadItems, watermarkOf } from "./cursors.js"
export { RETRY_CAP, RETRY_KINDS, retryAdd, retryAtCap, retryClear, retryDue, retryRows, retrySize, retryStatus } from "./retry.js"
export { commitBatch } from "./commit.js"
export { createQueue, splitOnStop } from "./answer.js"
export { buildBatch, deferThreads, dueNow, quietOf } from "./batch.js"
export { CONTEXT_TOKENS, MAX_ENTITIES, SUMMARY_CHARS, contextOf, rankEntities, summariesOf } from "./context.js"
export { claimOf, createStandInExtractor } from "./extractor.js"
export { createLeases } from "./lease.js"
export { createPool } from "./pool.js"
export { createScheduler, deadlineOf, LANE_TARGETS } from "./scheduler.js"
export { recordShadow, shadowRows } from "./shadow.js"
export { READY_SUFFIX, clearReady, readReady, readyIndex, readyPath, touchReady } from "./ready.js"
export { EngineError } from "./errors.js"

/**
 * @param {{store?: any, config?: Record<string, unknown>, log?: any, guard?: any, env?: Record<string, string | undefined>, now?: () => Date}} [options]
 */
export function createEngine({ store = null, config = {}, log = null, guard = null, env, now = () => new Date(), llm = null } = {}) {
  const mode = config.engine ?? engineMode(env ?? config.env ?? process.env)
  const on = engineOn(mode)
  const cohort = config.cohort instanceof Set ? config.cohort : new Set(config.cohort ?? cohortOf(env ?? config.env ?? process.env))
  if (on && mode === "on") log?.({ level: "warn", msg: "records.engine", warning: "RECORDS_ENGINE=on is reserved for S8; this build runs the ingest half only, with no lease and no model call" })
  // The leases run in `shadow` for the cohort only: outside it, and with `off` or
  // `ingest`, nothing in S3b runs (design §6).
  const shadow = mode === "shadow"
  const shadowForSpace = (spaceId) => shadowFor(spaceId, { mode, cohort })
  let runner = null
  let timer = null
  let canary = null
  let ticking = false
  let tickSkipped = false
  let tickStuck = false
  // The cell's engine spend, and the §10.5 metrics: both read the ready index
  // and counters, never the space files (plan §4).
  const cellLedger = store?.dataDir ? createCellLedger({ dataDir: store.dataDir, now }) : null
  let lease = null
  let lag = null
  const metricsNow = () => {
    if (!lag) {
      lag = monitorEventLoopDelay({ resolution: 20 })
      lag.enable()
      lag.unref?.()
    }
    const disk = store?.dataDir ? diskUsed(store.dataDir) : null
    return collectMetrics({
      ready: store?.spacesDir ? readyIndex(store.spacesDir).filter((entry) => shadowForSpace(entry.space)) : [],
      counters: { engine: runner?.status() ?? null, retry: null },
      breaks: guard ? Object.fromEntries((guard.tiers?.() ?? []).map((tier) => [tier, guard.cellState?.(tier) ?? "closed"])) : {},
      disk,
      eventLoop: lag ? lag.mean / 1e6 : null,
      now: now().getTime(),
      lease,
      canary: canary?.state?.lastPage ? { page: canary.state.lastPage } : null,
      spend: cellLedger ? { spent: cellLedger.state().tokens, cap: config.shadowTokens ?? 0, day: cellLedger.state().day } : null,
    })
  }

  /**
   * What this cell's engine holds, for `routines.status`, `/metrics` and the
   * console (S3c renders it): the mode, the space's cursors, its retry set, and
   * every lane the cap is stopping, said in a sentence a person can act on.
   */
  function status(handle = null) {
    const base = { mode, on, lanes: LANES }
    // The engine's own pauses are the process's, not one space's: they answer
    // without a handle too.
    const paused = runner?.paused ?? null
    const version = runner?.tiers?.state?.().version ?? []
    if (!handle) return { ...base, cursors: [], retry: null, stalled: [], paused, version }
    const cursors = cursorsAll(handle)
    const retry = retryStatus(handle)
    const stalled = []
    if (retry.full) {
      const stopped = new Set(handle.all("select distinct lane from lane_retry").map((row) => row.lane))
      for (const lane of LANES) if (pendingWork(handle, lane)) stopped.add(lane)
      for (const lane of [...stopped].filter(Boolean).sort()) {
        stalled.push({
          lane,
          reason: "retry_cap",
          message: `The ${lane} lane stops advancing: this space's retry set holds ${retry.total} rows, at the cap of ${retry.cap}.`,
        })
      }
    }
    return { ...base, cursors, retry, stalled, paused: runner?.paused ?? null, version: runner?.tiers?.state?.().version ?? [] }
  }

  const api = {
    mode,
    on,
    guard,
    store,
    now,
    llm,
    lanes: LANES,
    laneOf,
    openLane,
    cohort,
    shadow: shadow,
    shadowFor: shadowForSpace,
    runner,
    /** One shadow pass over the cohort's ready spaces, one tick at a time (review L1). */
    async tick(options = {}) {
      if (!runner) return []
      if (ticking) {
        if (!tickSkipped) {
          tickSkipped = true
          log?.({ level: "warn", msg: "records.engine.tick", skipped: true, reason: "the previous tick is still running" })
        }
        return [{ skipped: "busy" }]
      }
      ticking = true
      const deadline = Math.max(1_000, Number(config.tickDeadlineMs) || Math.min(15 * 60_000, 3 * (Number(config.callTimeoutMs) || 120_000)))
      let timer = null
      try {
        // A tick has a deadline: past it the guard is released, the tick is
        // abandoned (its later commits are fenced) and the line is logged once.
        const stuck = new Promise((resolve) => {
          timer = setTimeout(() => resolve({ stuck: true }), deadline)
          timer.unref?.()
        })
        const ran = await Promise.race([runner.tick(options), stuck])
        if (ran?.stuck) {
          runner.abandon?.()
          if (!tickStuck) {
            tickStuck = true
            ;(log ?? api.log)?.({ level: "error", msg: "memory.engine.tick_stuck", deadline_ms: deadline, next: "Read the engine's last call: a tick that passes its deadline is abandoned and its commits refused." })
          }
          return [{ skipped: "stuck" }]
        }
        return ran
      } finally {
        if (timer) clearTimeout(timer)
        ticking = false
        tickSkipped = false
      }
    },
    /** The cell's engine spend, read from its own file and never from the spaces. */
    cellLedger,
    /** The §10.5 metrics and the pages they fire. */
    metrics() {
      const collected = metricsNow()
      return { ...collected, pages: pages(collected, { now: Date.parse(collected.at) }) }
    },
    /** The fair-share cap for one space, from the service cap and the active set. */
    capFor(space, { configured = config.serviceTokens ?? 3_000_000, weight = 1 } = {}) {
      const active = store?.spacesDir ? readyIndex(store.spacesDir).filter((entry) => shadowForSpace(entry.space)).length : 1
      return fairShareCap({ configured, service: configured, weight, active })
    },
    /** The canary, when a deployment named its space. */
    get canary() {
      return canary
    },
    /** Start the shadow's own clock; the service calls this once. */
    start({ everyMs = config.tickMs ?? 60_000, canaryMs = 15 * 60_000 } = {}) {
      if (!runner || timer) return false
      if (config.canarySpace && !canary) canary = createCanary({ store, space: config.canarySpace, now, everyMs: canaryMs })
      timer = setInterval(() => {
        const started = now().getTime()
        // Every tick goes through the one guard (review M3).
        void api.tick({ everyMs })
          .then(() => (canary ? canary.tick() : null))
          .then((answer) => {
            lease = { lastCompleted: answer?.sent ? now().getTime() : lease?.lastCompleted ?? null, inFlight: 0 }
            cellLedger?.save()
          })
          .catch((error) => log?.({ level: "error", msg: "records.engine.tick", error: String(error?.message ?? error).slice(0, 200) }))
        void started
      }, Math.max(1_000, everyMs))
      timer.unref?.()
      return true
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = null
    },
    status,
    // The ready index (design §10.5): a space with work says so in one file, and
    // the index is those files alone, never a listing of the space files.
    ready: {
      index: () => (store?.spacesDir ? readyIndex(store.spacesDir) : []),
      touch: (spaceId, state) => (store?.spacesDir ? touchReady(store.spacesDir, spaceId, state) : { written: false, state: null }),
      clear: (spaceId) => (store?.spacesDir ? clearReady(store.spacesDir, spaceId) : false),
    },
  }
  // Built last, so the runner can hold the engine it belongs to.
  if (shadow && store && llm) {
    runner = createRunner({ store, engine: api, llm, log, guard, config: { ...config, retentionDays: config.retentionDays ?? 30 }, now })
    api.runner = runner
  }
  return api
}
