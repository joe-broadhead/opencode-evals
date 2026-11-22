/**
 * One space's shadow pass (design §10.1–10.3, §6; the plan's §3): read a lane,
 * let go of the file, call the model, reopen and commit.
 *
 * The order is the design's, and it is not an accident:
 *
 * 1. **Read** the lane's unread rows and the retry rows that are due, from the
 *    ready index's space only.
 * 2. **Release** the handle (`store.releaseSpace`) before the model's `await`:
 *    `handleFor` closes an evicted handle, so a lease that held one would commit
 *    through a closed file.
 * 3. **Call** once, through the tier's pool and the shared guard.
 * 4. **Reopen** and commit in one savepoint: the shadow rows, the deferred
 *    threads, the ledger line and the cursor.
 *
 * In shadow it writes `engine_shadow` and the ledger only: no projection, no
 * proposal and no record. A failure is the cell's, never the space's.
 */
import { estimateTokens } from "../routines/llm.js"
import { createQueue, splitOnStop } from "./answer.js"
import { buildBatch, deferThreads, fitItems, MAX_BATCH_CHARS } from "./batch.js"
import { commitBatch } from "./commit.js"
import { contextOf } from "./context.js"
import { cursorOf, unreadItems } from "./cursors.js"
import { createStandInExtractor } from "./extractor.js"
import { createLeases } from "./lease.js"
import { createPool } from "./pool.js"
import { createScheduler } from "./scheduler.js"
import { VERSION_PROBE_ITEMS, classifyFailure, createTiers } from "./tiers.js"
import { admit } from "./admission.js"
import { recordShadow } from "./shadow.js"
import { MAX_PER_CALL, holdReason, needsTraitGate } from "./traits.js"
import { FAILED_MAX, backoffMs, retryDueAll, retryOf } from "./retry.js"
import { createTraitGate } from "../routines/traits.js"
import { clearReady, readyIndex } from "./ready.js"

export const READ_LIMIT = 200
/** How many of the engine's own faults in a row pause it for the cell. */
export const ENGINE_FAULT_RUN = 3
/** A pause's first cool-down, and the most it may grow to. */
export const PAUSE_COOL_MS = 5 * 60_000
/** How long one probe batch may run before it is settled where it stands. */
export const PROBE_BATCH_MS = 10 * 60_000
export const PAUSE_MAX_MS = 60 * 60_000

/** The pause as an operator reads it: its class, since when, and its next probe. */
export function pauseOf({ reason, at, until, class: klass, status, cool_ms: cool }) {
  return { reason, since: at, class: klass ?? null, status: status ?? null, next_probe: until ?? null, cool_ms: cool ?? null }
}
export const TICK_SPACES = 8

const parse = (value, fallback) => {
  try {
    return value === null || value === undefined ? fallback : JSON.parse(value)
  } catch {
    return fallback
  }
}

/**
 * @param {{store: any, engine: any, llm: any, log?: any, guard?: any, config?: object, now?: () => Date}} input
 */
export function createRunner({ store, engine, llm, log = null, guard = null, config = {}, now = () => new Date() }) {
  const pool = createPool({ size: config.poolSize ?? 2, timeoutMs: config.callTimeoutMs ?? 120_000 })
  const classifyPool = createPool({ size: config.poolSize ?? 2, timeoutMs: config.callTimeoutMs ?? 120_000 })
  const leases = createLeases()
  const queue = createQueue()
  const scheduler = createScheduler({ now: () => now().getTime(), retentionDays: config.retentionDays ?? 30 })
  const tiers = config.tiers ?? createTiers({ now: () => now().getTime(), log })
  const extractorOf = () => createStandInExtractor({ llm: api.llm })
  const say = (line) => {
    const sink = api?.log ?? log
    if (typeof sink === "function") sink(line)
    else sink?.error?.(line)
  }
  /** End the probe batch: at most one bad answer resumes the digest. */
  const settleProbeBatch = () => {
    if (!state.probe) return
    const batchProbe = state.probe
    state.probe = null
    const settled = api.tiers.settleProbe(batchProbe.digest, { bad: batchProbe.bad })
    if (!settled.resumed) say({ event: "memory.engine.version_paused", digest: batchProbe.digest, bad: batchProbe.bad, next_probe: settled.next_probe })
  }
  const state = { calls: 0, tokens: 0, committed: 0, failed: 0, refused: 0, rate_limited: 0, held: 0, lastSuccessAt: 0, successCount: 0, faultRun: 0, paused: null, coolMs: PAUSE_COOL_MS, probing: false, marks: new Map(), probe: null, generation: 0, day: null, spentToday: 0, reserved: 0, leases: 0 }
  /** Pause the engine for the cell: one log line when it starts, never per probe. */
  const pause = (reason, detail) => {
    // A first pause starts at five minutes; a re-pause doubles **from the wait it
    // had** (review L2): 5, 10, 20, 40, 60, 60.
    const again = state.paused?.reason === reason
    state.coolMs = again ? Math.min(PAUSE_MAX_MS, state.coolMs * 2) : PAUSE_COOL_MS
    const at = now().toISOString()
    const until = new Date(now().getTime() + state.coolMs).toISOString()
    const first = state.paused === null || state.paused.reason !== reason
    state.paused = { reason, at, until, cool_ms: state.coolMs, ...detail }
    state.probing = false
    if (first) say({ event: reason === "auth" ? "memory.engine.auth" : "memory.engine.fault", space: null, ...detail, until, next: reason === "auth" ? "Check RECORDS_LLM_KEY and the model's URL: no call can succeed for any space." : "Read the engine's own error's class above; the work waits for the probe." })
    return state.paused
  }

  /**
   * The shadow spend of one UTC day, against `RECORDS_ENGINE_SHADOW_TOKENS`: the
   * ledger is the record, so a restart does not start the day again (review M3),
   * and the classifier's own calls count because they are in the ledger too.
   * `0` means no separate cap: the service cap alone bounds the cohort.
   */
  function shadowBudget({ tokens }) {
    const day = now().toISOString().slice(0, 10)
    const cap = Number(config.shadowTokens)
    if (!Number.isFinite(cap) || cap <= 0) return true
    if (state.day !== day) {
      state.day = day
      state.spentToday = 0
      const midnight = `${day}T00:00:00.000Z`
      for (const entry of readyIndex(store.spacesDir)) {
        if (!engine.shadowFor(entry.space)) continue
        const handle = store.spaceHandle(entry.space)
        state.spentToday += Number(handle?.get("select coalesce(sum(tokens), 0) as n from lane_ledger where at >= ?", midnight)?.n) || 0
        store.releaseSpace(entry.space)
      }
    }
    return { cap, tokens }
  }

  /**
   * Reserve a call's estimate before it is made, and replace the reservation with
   * what the provider bills when it answers (review L): a call's spend is counted
   * once, never as an estimate and a bill.
   */
  function reserveBudget({ tokens }) {
    const checked = shadowBudget({ tokens })
    if (checked === false) return null
    if (state.spentToday + state.reserved + tokens > checked.cap) return null
    state.reserved += tokens
    return tokens
  }
  function settleBudget(reservation, actual) {
    state.reserved = Math.max(0, state.reserved - (Number(reservation) || 0))
    state.spentToday += Number(actual) || 0
  }

  /** The event rows behind a set of ids, as batch items. */
  function rowsOfIds(handle, ids) {
    if (ids.length === 0) return []
    return handle
      .all(`select id, seq, source, account, lane, thread, title, text, actors, occurred_at, ingested_at from events where id in (${ids.map(() => "?").join(", ")}) order by seq`, ...ids)
      .map((row) => {
        const actors = parse(row.actors, [])
        return {
          ref: row.id,
          seq: row.seq,
          lane: row.lane,
          source: row.source,
          account: row.account,
          thread: row.thread ?? row.id,
          kind: "event",
          title: row.title ?? "",
          at: row.occurred_at,
          ingested_at: row.ingested_at,
          segments: [{ text: String(row.text ?? ""), author: { id: actors[0]?.id ?? null, name: actors[0]?.name ?? "unknown", self: false } }],
          people: [],
          projects: [],
        }
      })
  }

  /** One lane's unread rows, as batch items with what the prompt needs. */
  function rowsOf(handle, group, { limit = READ_LIMIT } = {}) {
    const rows = handle.all(
      "select id, seq, source, account, lane, thread, title, text, actors, occurred_at, ingested_at from events where lane = ? and source = ? and account = ? and seq > ? order by seq limit ?",
      group.lane,
      group.source,
      group.account,
      cursorOf(handle, group),
      limit,
    )
    return rows.map((row) => {
      const actors = parse(row.actors, [])
      return {
        ref: row.id,
        seq: row.seq,
        lane: row.lane,
        source: row.source,
        account: row.account,
        thread: row.thread ?? row.id,
        kind: "event",
        title: row.title ?? "",
        at: row.occurred_at,
        ingested_at: row.ingested_at,
        segments: [{ text: String(row.text ?? ""), author: { id: actors[0]?.id ?? null, name: actors[0]?.name ?? "unknown", self: false } }],
        people: [],
        projects: [],
      }
    })
  }

  /** One lane + source key, as the scheduler's candidate. */
  function candidateOf(spaceId, group, items, handle) {
    const oldest = items.length ? items.reduce((best, item) => (best === null || item.ingested_at < best ? item.ingested_at : best), null) : now().toISOString()
    const text = items.length ? items.map((item) => item.segments.map((segment) => segment.text).join("")).join("\n") : "queued"
    return {
      space: spaceId,
      lane: group.lane,
      source: group.source,
      account: group.account,
      oldestAt: oldest,
      tokens: Math.max(1, estimateTokens(text)),
      items: items.length,
      lo: cursorOf(handle, group),
      hi: items.length ? Number(items.at(-1).seq) : cursorOf(handle, group),
    }
  }

  /** S0's unit shape, from a batch's items: one unit per thread. */
  function toUnits(items) {
    const groups = new Map()
    for (const item of items) {
      if (!groups.has(item.thread)) groups.set(item.thread, [])
      groups.get(item.thread).push(item)
    }
    return [...groups.entries()].map(([key, list], index) => ({
      uid: `u${index + 1}`,
      key,
      kind: "event",
      source: list[0].source,
      title: list[0].title,
      at: list[0].at,
      rank: 1,
      items: list.map((item) => ({ ref: item.ref, type: "event", kind: item.kind, at: item.at, segments: item.segments, addressed: false })),
      people: new Set(),
      projects: new Set(),
    }))
  }

  /** Start the cohort's cursors at the seq each lane holds now (forward only, §6). */
  function startCohort(handle, spaceId) {
    const started = handle.get("select value from meta where key = 'engine_shadow_started'")?.value
    if (started) return false
    const at = now().toISOString()
    for (const row of handle.all("select lane, source, account, max(seq) as hi from events where seq is not null and lane is not null group by lane, source, account")) {
      handle.run("insert into lane_cursors (lane, source, account, cursor, updated) values (?, ?, ?, ?, ?) on conflict(lane, source, account) do nothing", row.lane, row.source, row.account, Number(row.hi) || 0, at)
    }
    handle.run("insert into meta (key, value) values ('engine_shadow_started', ?) on conflict(key) do update set value = excluded.value", at)
    return true
  }

  const api = {
    pool,
    classifyPool,
    leases,
    queue,
    scheduler,
    get extractor() {
      return extractorOf()
    },
    /** The extractor digest the version pause is keyed by. */
    version: "engine-standin@v1",
    state,
    llm,
    get paused() {
      return state.paused ? pauseOf({ ...state.paused, until: state.paused.until }) : null
    },
    guard,
    tiers,
    log,
    /** S3b's tests place a crash here: after the answer, before the commit. */
    beforeCommit: null,

    /**
     * The moment a space joins the cohort: its cursors start at the seq each lane
     * holds now, so the engine never re-reads the history the daily already read
     * (design §6). Called by the service once, and by a test before it ingests.
     */
    begin(spaceId) {
      if (!engine.shadowFor(spaceId)) return false
      const handle = store.spaceHandle(spaceId)
      if (!handle) return false
      const started = startCohort(handle, spaceId)
      store.releaseSpace(spaceId)
      return started
    },

    /**
     * One pass over one space. Answers what it did: `{leased, committed,
     * tokens, stop}` or `{leased: false}`.
     */
    async runSpace(spaceId) {
      if (!engine.shadowFor(spaceId)) return null
      // A paused engine holds its work: its own bug or a wrong key stops the
      // shadow for the cell, never the daily (review H, M).
      const generation = state.generation
      if (state.paused) {
        const due = Date.parse(String(state.paused.next_probe ?? state.paused.until ?? 0)) <= now().getTime()
        if (!due) {
          state.held += 1
          return { leased: false, error: `paused:${state.paused.reason}` }
        }
        // The cool-down has passed: this pass is the probe, one call.
        state.probing = true
      }
      // The space is acquired for the read, and its token released before the
      // model's `await` (design §3). The count keeps another caller's release
      // from closing it under this pass (review M5).
      const held = store.acquireSpace(spaceId)
      const handle = held.handle
      if (!handle) return null
      const release = held.release
      startCohort(handle, spaceId)
      // The candidates: every lane and source key with unread rows, minus the
      // keys another pass already holds.
      const groups = new Map()
      for (const row of handle.all("select distinct lane, source, account from events where lane is not null")) {
        groups.set(`${row.lane}|${row.source}|${row.account}`, { lane: row.lane, source: row.source, account: row.account })
      }
      // The retry set is work too (review H2): a deferred thread past its
      // `not_before`, and a failed item after its back-off, are leased like a
      // lane's unread rows. Its rows may sit at or below the cursor by design.
      const retries = new Map()
      for (const row of retryDueAll(handle, { now: now().toISOString() })) {
        const key = `${row.lane}|${row.source}|${row.account}`
        if (!retries.has(key)) retries.set(key, [])
        retries.get(key).push(row)
      }
      for (const row of retries.values()) {
        const { lane, source, account } = row[0]
        const key = `${lane}|${source}|${account}`
        if (!groups.has(key)) groups.set(key, { lane, source, account })
      }
      const candidates = []
      for (const group of groups.values()) {
        if (leases.busy({ space: spaceId, ...group })) continue
        const due = retries.get(`${group.lane}|${group.source}|${group.account}`) ?? []
        const items = rowsOf(handle, group)
        // A queued half of a split answer is work even when the lane has no
        // unread row left: its items sit at or below the cursor by design.
        const waiting = queue.size(`${spaceId}|${group.lane}|${group.source}|${group.account}`) > 0
        if (items.length === 0 && !waiting && due.length === 0) continue
        const candidate = { ...candidateOf(spaceId, group, items, handle), rows: items, waiting, retryRows: due }
        // A due retry's deadline is its **arrival**, never its `not_before`
        // (decision 8): `not_before` is when it became due, so a 429's wait or
        // an outage's back-off would otherwise push a retry behind fresher work
        // (S3e review M1). `not_before` still orders the retry set's own reads.
        if (due.length > 0) {
          const ids = due.map((row) => row.event_id)
          const arrival = handle.get(`select min(ingested_at) as at from events where id in (${ids.map(() => "?").join(", ")})`, ...ids)?.at
          candidate.oldestAt = arrival ?? now().toISOString()
        }
        candidates.push(candidate)
      }
      // A queued half of a split answer goes first, at the head of its key.
      const queuedKeys = queue.keys().filter((key) => key.startsWith(`${spaceId}|`))
      const chosen = queuedKeys.length > 0 ? candidates.find((candidate) => queuedKeys.includes(`${spaceId}|${candidate.lane}|${candidate.source}|${candidate.account}`)) ?? null : scheduler.pick(candidates)
      if (!chosen) {
        release()
        return { leased: false }
      }
      const lease = { space: spaceId, lane: chosen.lane, source: chosen.source, account: chosen.account }
      if (!leases.acquire(lease)) {
        release()
        return { leased: false }
      }
      state.leases += 1
      try {
        const key = leases.keyOf(lease)
        // A queued half, or the lane's own next batch.
        let batch
        let retryItems = []
        if ((chosen.retryRows ?? []).length > 0) {
          // The retry set's own batch: its items are read again where they are,
          // below the cursor, so the cursor does not move. It takes the same
          // character budget a lane's batch does (review S3d): a crowd of due
          // retries is read over passes, not in one oversized call.
          retryItems = fitItems(rowsOfIds(handle, chosen.retryRows.map((row) => row.event_id)), config.batchChars ?? MAX_BATCH_CHARS).items
          batch = {
            lane: chosen.lane,
            source: chosen.source,
            account: chosen.account,
            items: retryItems,
            units: toUnits(retryItems),
            lo: cursorOf(handle, lease),
            hi: cursorOf(handle, lease),
            retry: true,
          }
        } else if (queue.size(key) > 0) {
          const piece = queue.take(key)
          batch = { ...piece, lane: chosen.lane, source: chosen.source, account: chosen.account, hmm: true }
          batch.items = chosen.rows.filter((item) => item.seq > piece.lo && item.seq <= piece.hi)
          batch.lo = piece.lo
          batch.hi = piece.hi
          batch.units = toUnits(batch.items)
        } else {
          const quiet = deferThreads(chosen.rows, { lane: chosen.lane, now: now().getTime() })
          const built = buildBatch({ items: quiet.ready, lane: chosen.lane, source: chosen.source, account: chosen.account, maxChars: config.batchChars ?? 24_000, toUnits })
          batch = { ...built, lo: cursorOf(handle, lease), hi: built.items.at(-1)?.seq ?? cursorOf(handle, lease), deferred: quiet.deferred }
        }
        if (batch.items.length === 0) {
          // Nothing quiet: the cursor advances past the deferred threads, whose
          // rows are the retry set's.
          commitBatch(handle, {
            ...lease,
            expectFrom: cursorOf(handle, lease),
            to: chosen.hi,
            retry: (batch.deferred ?? []).flatMap((thread) => chosen.rows.filter((item) => item.thread === thread.thread && Number(item.seq) <= chosen.hi).map((item) => ({ eventId: item.ref, kind: "deferred", notBefore: thread.notBefore, reason: "the thread was not quiet" }))),
            ledger: { items: 0, tokens: 0, calls: 0, outcome: "deferred" },
            now: now().toISOString(),
          })
          return { leased: true, committed: 0, tokens: 0, deferred: batch.deferred?.length ?? 0 }
        }
        // A paused extractor digest is not called at all, except for its probe
        // batch of twenty items once the cool-down has passed (the plan's §6
        // names no exit; the coordinator's decision does).
        const versionProbe = api.tiers.isPaused(api.version) ? api.tiers.probeDue(api.version) : false
        if (api.tiers.isPaused(api.version) && !versionProbe) {
          state.held += 1
          release()
          return { leased: true, committed: 0, tokens: 0, error: "version_paused", pause: api.tiers.pauseOf(api.version) }
        }
        if (versionProbe) {
          // The probe is one batch: at most twenty calls, or its deadline.
          if (!state.probe || state.probe.digest !== api.version) state.probe = { digest: api.version, calls: 0, bad: 0, deadline: now().getTime() + PROBE_BATCH_MS }
          else if (state.probe.calls >= VERSION_PROBE_ITEMS || now().getTime() > state.probe.deadline) {
            settleProbeBatch()
            if (api.tiers.isPaused(api.version)) {
              state.held += 1
              release()
              return { leased: true, committed: 0, tokens: 0, error: "version_paused", pause: api.tiers.pauseOf(api.version) }
            }
          }
          // The probe reads at most twenty items of the digest, one call each.
          batch.items = batch.items.slice(0, 1)
          batch.units = toUnits(batch.items)
        }
        const reservation = reserveBudget({ tokens: Number(chosen.tokens) || 1 })
        if (reservation === null) return { leased: true, committed: 0, tokens: 0, budget: "shadow_tokens" }
        const entities = handle.all("select path, title from records where kind = 'page' and type in ('person', 'project') order by path limit 400").map((row) => ({ path: row.path, title: row.title ?? row.path }))
        // What the call may cite: every page of the space (the model narrows its
        // own answer), while the context itself carries the cited ones.
        const paths = new Set(entities.map((entity) => entity.path))
        const context = contextOf({ entities, threads: [...new Map(batch.items.map((item) => [item.thread, { key: item.thread, title: item.title, participants: item.segments.map((segment) => segment.author?.name) }])).values()], items: batch.items })
        context.paths = paths
        // The handle is let go **before** the call: read, release, call.
        release()
        // The tier's own wait (a 429 it was given) holds the work until it ends.
        if (api.tiers.notBefore("extract") > now().getTime()) {
          state.held += 1
          release()
          return { leased: true, committed: 0, tokens: 0, error: "tier_wait", notBefore: api.tiers.notBefore("extract") }
        }
        let answer
        // A refusal is not a failure (review H1): the guard said no, so no call
        // reached the provider and nothing about it was learned. Neither breaker
        // moves, and a refusal while the cell breaker probes must not re-open it.
        try {
          await (engine.guard ?? guard)?.check?.(spaceId, { tokens: Number(chosen.tokens) || 1 })
        } catch (error) {
          state.refused += 1
          return { leased: true, committed: 0, tokens: 0, error: error?.code ?? "refused" }
        }
        try {
          // The extractor reads `api.llm` at the call, so a restarted engine (or a
          // test's second provider) is the one that answers.
          const standIn = createStandInExtractor({ llm: api.llm })
          answer = await pool.exec({ run: () => standIn.extract({ batch, context, summaries: context.summaries }) })
        } catch (error) {
          settleBudget(reservation, 0)
          // A 429 asks the tier to wait, not the worker to sleep: nothing is
          // charged, no breaker counts it, and the batch's items go back with a
          // `not_before` of what `Retry-After` named (plan §4).
          if (error?.status === 429 || error?.code === "llm_rate_limited") {
            const waited = api.tiers.delay("extract", Number(error?.retryAfterMs) || 30_000)
            state.rate_limited += 1
            return { leased: true, committed: 0, tokens: 0, error: "llm_rate_limited", notBefore: waited }
          }
          // The cell's extract tier is shared, so it must see the **true rate**
          // (review H): every call reports its outcome, successes included, and
          // only a provider failure is a failure — a 5xx, a timeout, a refused
          // connection. A 400 or an unusable answer is the item's, and the
          // provider answered, so it counts as a good outcome for the breaker.
          const cell = engine.guard ?? guard
          const status = Number(error?.status) || 0
          // Every outcome is named (review H and M): an engine bug must never
          // look like an outage, and a wrong key is an incident of its own.
          const kind = classifyFailure(error)
          const provider = kind === "provider"
          // A 200 that is not JSON is the model's quality: it is watched by the
          // version pause, and never by the engine's own fault pause (review M2).
          if (String(error?.code ?? "") === "llm_bad_answer") {
            api.tiers.recordAnswer(api.version, { bad: true })
            // In the probe batch it is one bad answer, and it ends no later than
            // the batch's own twenty calls (review M2).
            if (state.probe && state.probe.digest === api.version) {
              state.probe.bad += 1
              state.probe.calls += 1
              if (state.probe.calls >= VERSION_PROBE_ITEMS || now().getTime() > state.probe.deadline || (chosen.rows?.length ?? 0) <= 1) settleProbeBatch()
            }
          }
          const outage = Number(cell?.cellOpenUntil?.("extract") ?? 0) > 0
          const isolated = (ref) => state.successCount > (state.marks.get(ref) ?? -1)
          // Only a provider failure touches the shared tier; an item's 400, an
          // auth's 401 and the engine's own bug are neutral for it.
          if (status !== 429 && error?.code !== "llm_rate_limited" && provider) cell?.fail?.(spaceId, error, { tier: "extract", cellOnly: true })
          // The engine's own fault, or a wrong key, pauses the **engine** for the
          // cell — never the daily (review H, M) — and says so once.
          if (kind === "fault") {
            state.faultRun += 1
            const probingFault = state.probing && state.paused?.reason === "fault"
            if (state.faultRun >= ENGINE_FAULT_RUN || probingFault) pause("fault", { class: String(error?.name ?? "Error"), count: state.faultRun })
          } else {
            state.faultRun = 0
          }
          if (kind === "auth" && (state.paused?.reason !== "auth" || state.probing)) pause("auth", { status })
          state.failed += 1
          if (generation !== state.generation) {
            // The tick this batch belonged to was abandoned: its failure writes
            // no retry row and spends no attempt (review M1).
            release()
            return { leased: true, committed: 0, tokens: 0, error: "stale_tick" }
          }
          log?.({ level: "warn", msg: "records.engine.shadow_failed", space: spaceId, lane: chosen.lane, error: String(error?.message ?? error).slice(0, 200) })
          const reason = String(error?.message ?? error).slice(0, 300)
          const at = now().toISOString()
          try {
            // The file was let go before the call, so the retry rows are written
            // through a handle opened for them.
            const tx = store.spaceHandle(spaceId)
            const retryRowsOf = (item) => {
              const had = retryOf(tx, item.ref)
              // An outage is not the item's failure: while the tier is open its
              // attempts do not move, and it is never set aside for the provider's
              // fault. While the tier is closed, an item whose own calls keep
              // failing spends them (review, the lost guarantee).
              // An outage, a wrong key and the engine's own bug spend nothing; an
              // item's own error spends its attempt (review H, M).
              const attempts = outage ? Number(had?.attempts) || 0 : Math.min(FAILED_MAX, (Number(had?.attempts) || 0))
              const spends = !outage && kind !== "auth" && kind !== "fault" && (!provider || isolated(item.ref))
              const spent = spends ? Math.min(FAILED_MAX, attempts + 1) : attempts
              state.marks.set(item.ref, state.successCount)
              return { eventId: item.ref, kind: "failed", attempts: spent, notBefore: new Date(now().getTime() + backoffMs(Math.max(1, spent))).toISOString(), reason }
            }
            commitBatch(tx, {
              ...lease,
              expectFrom: cursorOf(tx, lease),
              to: batch.retry ? cursorOf(tx, lease) : Math.max(cursorOf(tx, lease), batch.hi),
              // The rows are written here, not through `retryAdd`, because its
              // upsert counts an attempt and an outage must not spend one
              // (review M1): the attempts are this call's own number.
              file: (t) => {
                for (const row of batch.items.map(retryRowsOf)) {
                  t.run(
                    `insert into lane_retry (event_id, lane, source, account, kind, attempts, not_before, reason, created) values (?, ?, ?, ?, 'failed', ?, ?, ?, ?)
                     on conflict(event_id) do update set attempts = excluded.attempts, not_before = excluded.not_before, reason = excluded.reason`,
                    row.eventId,
                    lease.lane,
                    lease.source,
                    lease.account,
                    row.attempts,
                    row.notBefore,
                    String(row.reason ?? "").slice(0, 300),
                    at,
                  )
                }
              },
              ledger: { items: 0, tokens: 0, calls: Number(error?.calls) || 1, tier: "extract", outcome: "failed" },
              now: at,
            })
            release()
          } catch (commitError) {
            // A failed commit leaves the items where they were: the next pass
            // reads them again, which is the retry set's own answer.
            log?.({ level: "warn", msg: "records.engine.retry_write_failed", space: spaceId, error: String(commitError?.message ?? commitError).slice(0, 200) })
          }
          return { leased: true, committed: 0, tokens: 0, error: error?.code ?? "failed" }
        }
        state.calls += 1
        state.tokens += answer.usage.total
        // The reservation becomes the bill, and nothing is counted twice.
        settleBudget(reservation, answer.usage.total)
        // Every answer enters the digest's window, good or bad: the rate is bad
        // answers over all calls, not over the bad ones (review M1).
        const badAnswer = answer.stop === "length" || (answer.rejected?.length ?? 0) > 0
        api.tiers.recordAnswer(api.version, { bad: badAnswer })
        if (state.probe && state.probe.digest === api.version) {
          state.probe.calls += 1
          if (badAnswer) state.probe.bad += 1
          // The batch also ends when the lane has nothing left to probe.
          if (state.probe.calls >= VERSION_PROBE_ITEMS || now().getTime() > state.probe.deadline || (chosen.rows?.length ?? 0) <= 1) settleProbeBatch()
        }
        state.lastSuccessAt = now().getTime()
        state.successCount += 1
        // A call answered: the engine's own pause (a fault or a wrong key) is
        // over, and its wait starts again at five minutes.
        state.faultRun = 0
        state.paused = null
        state.coolMs = PAUSE_COOL_MS
        state.probing = false
        ;(engine.guard ?? guard)?.ok?.(spaceId, { tier: "extract", cellOnly: true })
        // The probe's answer is judged after the commit: its bad items spend
        // their attempts, and the digest resumes or re-pauses.
        const probeBad = versionProbe ? (answer.stop === "length" ? batch.items : batch.items.filter((item) => answer.rejected?.some((rejection) => rejection.item?.ref === item.ref))) : []
        const tx = store.spaceHandle(spaceId)
        if (this.beforeCommit) this.beforeCommit({ spaceId, batch, answer })
        let stop = null
        let keep = answer.claims
        let hi = batch.hi
        // What this line files: the whole batch, or the items a cut answer kept.
        let filed = batch.items.length
        if (answer.stop === "length") {
          // The complete items are kept and committed; the rest of the batch goes
          // back to the head of this key in two halves, first half first.
          const split = splitOnStop({ answer: { stop: answer.stop, items: answer.kept ?? answer.items }, batch })
          const keptRefs = new Set(split.keep.map((item) => item.ref))
          keep = answer.claims.filter((claim) => keptRefs.has(claim.refs?.[0]))
          if (split.halves.length > 0) {
            queue.push(key, split.halves.map((half) => ({ ...half, lane: chosen.lane, source: chosen.source, account: chosen.account })))
            hi = split.halves[0].lo
          }
          filed = split.keep.length
          stop = "length"
        }
        if (generation !== state.generation) {
          // The tick this batch belonged to was abandoned at its deadline: it may
          // never commit its result, but the provider did bill the call, so the
          // tokens reach the ledger (review L).
          // Every handle this bill opens is let go, on every path (review M):
          // a holder left behind keeps the file open until a restart.
          let stale = null
          try {
            stale = store.acquireSpace(spaceId)
            commitBatch(stale.handle, {
              ...lease,
              expectFrom: cursorOf(stale.handle, lease),
              to: cursorOf(stale.handle, lease),
              ledger: { items: 0, tokens: answer.usage.total, calls: answer.calls, tier: "extract", outcome: "abandoned" },
              now: now().toISOString(),
            })
          } catch {
            // A cursor that moved under it is the other tick's, and a failed
            // commit is the commit's: the bill is the space's either way, so a
            // plain ledger line is written instead, on a handle of its own that
            // is let go here whatever the write does (review L).
            let bill = null
            try {
              bill = store.acquireSpace(spaceId)
              bill.handle.run("insert into lane_ledger (id, at, lane, source, account, lo, hi, items, tier, tokens, calls, outcome, digest) values (?, ?, ?, ?, ?, 0, 0, 0, 'extract', ?, ?, 'abandoned', null)", `stale_${now().getTime().toString(36)}`, now().toISOString(), lease.lane, lease.source, lease.account, Number(answer.usage.total) || 0, Number(answer.calls) || 1)
            } catch {
              // Nothing else can be done: the space is gone or busy.
            } finally {
              bill?.release()
            }
          } finally {
            // The handle the failed commit took is let go too: it is the one
            // holder no other path releases (review L).
            stale?.release()
            release()
          }
          return { leased: true, committed: 0, tokens: 0, error: "stale_tick" }
        }
        const committed = commitBatch(tx, {
          ...lease,
          expectFrom: cursorOf(tx, lease),
          to: Math.max(cursorOf(tx, lease), hi),
          file: (t) => {
            // A retry row the batch read is read: it goes, so the item is not
            // leased twice (review H2).
            for (const item of batch.items) t.run("delete from lane_retry where event_id = ? and kind in ('deferred', 'failed')", item.ref)
            // A claim about a person in free text is never filed on the
            // extractor's word: it waits in the retry set as `held`, and a
            // classify lease asks S1's gate about it (design §5.4).
            const filed = []
            for (const claim of keep) {
              if (needsTraitGate(claim)) {
                // The row is about the **event** it came from, so a forget, an
                // erasure, an unbind and retention delete it with that event,
                // and the statement it carries goes with it (review H3).
                t.run(
                  "insert into lane_retry (event_id, lane, source, account, kind, attempts, not_before, reason, created) values (?, ?, ?, ?, 'held', 0, null, ?, ?) on conflict(event_id) do update set kind = 'held', reason = excluded.reason",
                  String(claim.refs?.[0] ?? claim.claim_key),
                  chosen.lane,
                  chosen.source,
                  chosen.account,
                  `${holdReason(claim)}: ${String(claim.statement ?? "").slice(0, 240)}`,
                  now().toISOString(),
                )
                continue
              }
              filed.push(claim)
            }
            recordShadow(t, { claims: filed, lane: chosen.lane, at: now().toISOString() })
            // A deferred thread needs a retry row only when the cursor moves past
            // it: an item above the new cursor is still unread, and the next
            // batch reads it once it is quiet. Rows for both would count it twice.
            for (const thread of batch.deferred ?? []) {
              for (const item of chosen.rows.filter((row) => row.thread === thread.thread && Number(row.seq) <= hi)) {
                t.run("insert into lane_retry (event_id, lane, source, account, kind, attempts, not_before, reason, created) values (?, ?, ?, ?, 'deferred', 0, ?, ?, ?) on conflict(event_id) do update set kind = excluded.kind, not_before = excluded.not_before", item.ref, chosen.lane, chosen.source, chosen.account, thread.notBefore, "the thread was not quiet", now().toISOString())
              }
            }
          },
          // The ledger's `items` is what the batch read — the number the
          // "every ingested item is leased once" count compares — and its
          // `tokens` is the provider's billed usage, to the token.
          ledger: { items: filed, tokens: answer.usage.total, calls: answer.calls, tier: "extract", outcome: stop ?? "committed", digest: `sha256:${answer.usage.total}` },
          now: now().toISOString(),
        })
        release()
        // The probe's answer settles the digest: at most one bad item resumes it,
        // more re-pause it, and the bad items spend their attempts.
        if (versionProbe && probeBad.length > 0) {
          // The batch itself settles its digest (the counter above); here its bad
          // items spend their attempts, as any item failure does.
          {
            const retryTx = store.acquireSpace(spaceId)
            for (const item of probeBad) {
              const had = retryOf(retryTx.handle, item.ref)
              const spent = Math.min(FAILED_MAX, (Number(had?.attempts) || 0) + 1)
              retryTx.handle.run(
                `insert into lane_retry (event_id, lane, source, account, kind, attempts, not_before, reason, created) values (?, ?, ?, ?, 'failed', ?, ?, ?, ?)
                 on conflict(event_id) do update set attempts = excluded.attempts, not_before = excluded.not_before, reason = excluded.reason`,
                item.ref,
                chosen.lane,
                chosen.source,
                chosen.account,
                spent,
                new Date(now().getTime() + backoffMs(Math.max(1, spent))).toISOString(),
                "the probe's answer was bad",
                now().toISOString(),
              )
            }
            retryTx.release()
          }
        }
        state.committed += committed.to - committed.from
        return { leased: true, committed: committed.to - committed.from, tokens: answer.usage.total, stop }
      } finally {
        release()
        leases.release(lease)
      }
    },

    /**
     * One `classify` lease: up to S1's `maxPerCall` holds of one space, in one
     * call to S1's gate. A flagged claim is dropped and never filed; a claim the
     * gate answered about is filed to the shadow log; a claim the gate did not
     * answer about stays held, and is retried (decision 2).
     */
    async classify(spaceId) {
      if (!engine.shadowFor(spaceId)) return null
      // The tick this lease belongs to: a fence for its writes (review L).
      const generation = state.generation
      // A paused engine holds its work here too (review M): the classifier is a
      // call like any other, so it waits for the probe and, when the cool-down
      // has passed, is the probe.
      if (state.paused) {
        const due = Date.parse(String(state.paused.next_probe ?? state.paused.until ?? 0)) <= now().getTime()
        if (!due) {
          state.held += 1
          return { taken: 0, dropped: 0, filed: 0, waiting: 0, error: `paused:${state.paused.reason}` }
        }
        state.probing = true
      }
      // The space is acquired for the read, and its token released before the
      // model's `await` (design §3). The count keeps another caller's release
      // from closing it under this pass (review M5).
      const held = store.acquireSpace(spaceId)
      const handle = held.handle
      if (!handle) return null
      const release = held.release
      const holds = handle.all("select event_id, lane, source, account, reason from lane_retry where kind = 'held' order by created, event_id limit ?", MAX_PER_CALL)
      if (holds.length === 0) {
        store.releaseSpace(spaceId)
        return { taken: 0, dropped: 0, filed: 0, waiting: 0 }
      }
      // The classifier is one call like any other: the guard and the shadow cap
      // come first (review M), and a refusal spends nothing and moves no breaker.
      try {
        await (engine.guard ?? guard)?.check(spaceId, { tokens: 800 })
      } catch (error) {
        state.refused += 1
        store.releaseSpace(spaceId)
        return { taken: holds.length, dropped: 0, filed: 0, waiting: holds.length, error: error?.code ?? "refused" }
      }
      const reservation = reserveBudget({ tokens: 800 })
      if (reservation === null) {
        store.releaseSpace(spaceId)
        return { taken: holds.length, dropped: 0, filed: 0, waiting: holds.length, error: "shadow_tokens" }
      }
      const entries = holds.map((hold, index) => ({ index, text: String(hold.reason ?? ""), quote: "", about: "person" }))
      // The handle is let go before the gate's call, as a batch's is.
      store.releaseSpace(spaceId)
      // The gate's own call is billed too: the wrapper counts what the provider
      // reports, so the ledger line is the bill and not an estimate.
      const bill = { tokens: 0, calls: 0 }
      // The call reports to the guard's **classify** tier, which is this lease's
      // own: only the engine uses it. S1's trait client elsewhere is untouched
      // and keeps the guard's default tier (review L2), so the classifier's
      // breaker and spend are the engine's, and its failures never block
      // extraction.
      const classifyGuard = engine.guard ?? guard
      const counting = {
        available: api.llm?.available !== false,
        async complete(input) {
          const answer = await (classifyGuard?.complete
            ? classifyGuard.complete(spaceId, () => api.llm.complete(input), { tier: "classify", tokens: 800 })
            : api.llm.complete(input))
          bill.tokens += Number(answer?.usage?.total) || 0
          bill.calls += Number(answer?.calls) || 1
          return answer
        },
      }
      const { gate } = createTraitGate({ llm: counting, maxPerCall: MAX_PER_CALL })
      let outcome
      try {
        outcome = await classifyPool.exec({ run: () => gate({ claims: entries }) })
      } catch (error) {
        // The shadow's failures move no breaker (design §6).
        settleBudget(reservation, 0)
        log?.({ level: "warn", msg: "records.engine.classify_failed", space: spaceId, error: String(error?.message ?? error).slice(0, 200) })
        return { taken: holds.length, dropped: 0, filed: 0, waiting: holds.length, error: error?.code ?? "failed" }
      }
      // The call was answered: the engine's own pause is over, as a batch's
      // success ends it (review M).
      state.faultRun = 0
      state.paused = null
      state.coolMs = PAUSE_COOL_MS
      state.probing = false
      ;(classifyGuard)?.ok?.(spaceId, { tier: "classify", cellOnly: true })
      // S1's gate answers `kept` as plain indices and `dropped` as entries.
      const dropped = new Set(outcome.dropped.map((entry) => entry.index))
      const answered = new Set([...outcome.kept.map((index) => Number(index)), ...dropped])
      settleBudget(reservation, bill.tokens)
      if (generation !== state.generation) {
        // The tick that began this classify was abandoned: no result, no hold
        // dropped, but its bill is recorded (review L).
        const stale = store.acquireSpace(spaceId)
        stale.handle.run("insert into lane_ledger (id, at, lane, source, account, lo, hi, items, tier, tokens, calls, outcome, digest) values (?, ?, ?, ?, ?, 0, 0, 0, 'classify', ?, ?, 'abandoned', null)", `stale_${now().getTime().toString(36)}`, now().toISOString(), holds[0].lane, holds[0].source, holds[0].account, Number(bill.tokens) || 0, Number(bill.calls) || 1)
        stale.release()
        return { taken: holds.length, dropped: 0, filed: 0, waiting: holds.length, error: "stale_tick" }
      }
      const tx = store.spaceHandle(spaceId)
      let filed = 0
      commitBatch(tx, {
        lane: holds[0].lane,
        source: holds[0].source,
        account: holds[0].account,
        expectFrom: cursorOf(tx, holds[0]),
        to: cursorOf(tx, holds[0]),
        file: (t) => {
          for (const [index, hold] of holds.entries()) {
            if (!answered.has(index)) continue
            t.run("delete from lane_retry where event_id = ? and kind = 'held'", hold.event_id)
            if (dropped.has(index)) continue
            recordShadow(t, {
              claims: [{ claim_key: hold.event_id, type: "fact", knowledge_key: `engine:held:${hold.event_id}`, statement: hold.reason, refs: [hold.event_id] }],
              lane: hold.lane,
              at: now().toISOString(),
            })
            filed += 1
          }
        },
        ledger: { items: filed, tokens: bill.tokens, calls: bill.calls, tier: "classify", outcome: "classified" },
        now: now().toISOString(),
      })
      store.releaseSpace(spaceId)
      return { taken: holds.length, dropped: dropped.size, filed, waiting: holds.length - answered.size }
    },

    /**
     * One tick: the cohort spaces the ready index names, chosen by the scheduler
     * — earliest deadline first, then fair share — and never by id order, so a
     * cell with more spaces than a tick is bounded does not read the same eight
     * for ever (review M4).
     */
    async tick({ max = TICK_SPACES } = {}) {
      const done = []
      // The generation this tick belongs to: abandoned at its deadline, it stops
      // at its next step and touches no further space (review L).
      const generation = state.generation
      const abandoned = () => state.generation !== generation
      // The candidates, from the markers alone: each space's earliest deadline,
      // and whether it has own work, which is what the reserve reads.
      const cohort = readyIndex(store.spacesDir).filter((entry) => engine.shadowFor(entry.space)).map((entry) => entry.space)
      // Admission (plan §4): a cell admits its cohort up to capacity, and says
      // which spaces wait.
      const admitted = admit({ cohort, active: 0, capacity: Number(config.capacity) || cohort.length })
      if (admitted.refused.length > 0) {
        ;(api.log ?? log)?.({ level: "warn", msg: "records.engine.admission", refused: admitted.refused.map((entry) => entry.space), capacity: Number(config.capacity), active: cohort.length })
      }
      const ready = readyIndex(store.spacesDir).filter((entry) => admitted.admitted.includes(entry.space))
      const candidates = ready.map((entry) => {
        const handle = store.spaceHandle(entry.space)
        const oldest = handle?.get("select min(ingested_at) as at from events where ingested_at is not null and seq is not null")?.at ?? null
        const own = Boolean(handle?.get("select 1 as hit from events where lane = 'own' limit 1"))
        store.releaseSpace(entry.space)
        return { space: entry.space, lane: own ? "own" : (entry.lanes?.[0] ?? "general"), oldestAt: oldest ?? new Date(0).toISOString(), tokens: Math.max(1, Number(entry.pending_tokens) || 1_000) }
      })
      if (abandoned()) return done
      const chosen = []
      const left = [...candidates]
      while (chosen.length < max && left.length > 0) {
        const pick = scheduler.pick(left, { slots: 10 })
        if (!pick) break
        chosen.push(pick)
        left.splice(left.indexOf(pick), 1)
      }
      for (const entry of chosen) {
        if (abandoned()) return done
        const answer = await api.runSpace(entry.space)
        if (abandoned()) return done
        // A hold waits for the classifier, and the classifier is a lease like any
        // other: a tick takes it, so holds cannot grow to the cap (review H3).
        const handle = store.spaceHandle(entry.space)
        const held = handle?.get("select count(*) as n from lane_retry where kind = 'held'")?.n
        const unread = handle?.get(
          "select count(*) as n from events e where e.seq > coalesce((select c.cursor from lane_cursors c where c.lane = e.lane and c.source = e.source and c.account = e.account), 0)",
        )?.n
        const due = handle?.get("select count(*) as n from lane_retry where kind in ('deferred', 'failed') and (not_before is null or not_before <= ?)", now().toISOString())?.n
        store.releaseSpace(entry.space)
        const classified = Number(held) > 0 ? await api.classify(entry.space) : null
        if (abandoned()) return done
        // A space with nothing left stops saying it has work (review M4).
        if (Number(unread) === 0 && Number(due) === 0 && Number(held) === 0) clearReady(store.spacesDir, entry.space)
        if (answer || classified) done.push({ space: entry.space, ...(answer ?? {}), ...(classified ? { classified } : {}) })
      }
      return done
    },
    /** No `listSpaces`, ever: the ready index is the only input. */
    /** Abandon a stuck tick: its later commits are refused by the fence. */
    abandon() {
      state.generation += 1
      state.probe = null
      // The abandoned tick still holds the keys it leased; a later tick must be
      // able to lease them without a restart (review M2).
      leases.reset()
      return state.generation
    },
    status() {
      return { calls: state.calls, tokens: state.tokens, committed: state.committed, failed: state.failed, leases: leases.size, queued: queue.keys().length, paused: api.paused, version: api.tiers.state?.().version ?? [] }
    },
  }
  return api
}
