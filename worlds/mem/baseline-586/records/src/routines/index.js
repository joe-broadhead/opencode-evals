/**
 * The routines of the records service (memory-v1-contracts.md §5).
 *
 * `createRoutines({store, config, log, now?})` →
 * `{run(spaceId, routine, date, actor), status(spaceId), start(), stop(), tick()}`.
 * Lane REC wires `run` to `routines.run` and `status` to `routines.status`.
 *
 * Spaces are keyed by the control space id (§2.3); the container (`meta.team`)
 * is used only to read the space's turns from the core: `team_id`, plus
 * `user_id = meta.owner_user` for a personal space, because legacy personal
 * spaces share a container, plus one `agent_id` per agent the space has seen.
 * A personal space whose owner is unknown reads no turns at all rather than
 * the whole container. The core's service id is the space's `meta.service`;
 * `RECORDS_CORE_SERVICE_ID` is only the fallback when the space has none.
 *
 * The scheduler ticks every 10 minutes. For each space (`store.listSpaces()`):
 * the daily journal runs once the space's local time (`fields.tz` of `index`,
 * else UTC) is past `RECORDS_ROUTINE_HOUR`, and again on new activity (turns,
 * records, events) until the journal is edited; yesterday is caught up once if
 * it never ran; weekly runs on Monday for the previous week, monthly on the 1st
 * for the previous month; lint and the dashboard run after each journal. At
 * most two spaces run at once, and their starts are staggered.
 *
 * Spend (FABLE records #5): one routine at a time per space (a lock shared by
 * manual and scheduled runs), so two runs never each spend the remainder; a
 * service-wide daily cap over every space (`RECORDS_SERVICE_BUDGET_TOKENS`,
 * UTC day); failed and timed-out model calls are charged; and a circuit
 * breaker stops calling the model after `RECORDS_LLM_BREAKER_FAILURES` failed
 * calls in a row. From 0.11 the per-space day and the breaker come from
 * `records/src/model-guard.js`, **one per space shared with the job runner**:
 * the day is the routines' `runs` and the jobs' `job_runs` together. A run
 * stops calling the model after `maxRunMs`; a `running` row older than twice
 * that is a run a restart interrupted: it is marked failed and the day runs
 * again.
 *
 * The lock, the breaker and the service-wide cap's running count are per
 * process (memory of this records process). That is safe with the one records
 * process a cell runs today. Running two would need a shared lock (a lease row
 * per space), a shared breaker and a cap summed from the ledgers on each check:
 * until then, run one records process per set of space files.
 */
import { randomBytes } from "node:crypto"
import { errorText } from "../text.js"
import { createCoreReader } from "./core.js"
import { DAILY_VERSION, RETRY_NEXT_TICK, runDaily } from "./daily.js"
import { CLOSE, OPEN, mergeDashboard, renderDashboard, splitDashboard } from "./dashboard.js"
import { addDays, dayBounds, isDay, localDay, localHour, safeTz, weekday, weekDays, monthDays } from "./dates.js"
import { LlmError, createLlm, openBudget, estimateTokens } from "./llm.js"
import { createModelGuard } from "../model-guard.js"
import { traitBreakerOfCell } from "./traits.js"
import { applyMode } from "./policy.js"
import { lintRecords, readAll } from "./lint.js"
import { renderRollup } from "./rollup.js"
import { ALERT_OUTCOMES, emit, runLine } from "./log.js"
import { resolveSecretFiles } from "../secret-files.js"

// A run's own retry code, named where the scheduler's other codes live.
export { RETRY_NEXT_TICK } from "./daily.js"

export const ROUTINES = Object.freeze(["daily", "weekly", "monthly", "lint", "dashboard"])
export const VERSIONS = Object.freeze({ daily: DAILY_VERSION, weekly: "weekly@v1", monthly: "monthly@v1", lint: "lint@v1", dashboard: "dashboard@v1" })
export const ROUTINE_USER = "routines"
export const ROUTINE_AGENT = "routines"
/**
 * What a catch-up run may spend of one local day's budget (FINDINGS R6): at
 * most half, so a backlog can never starve the day's own reading. The day's cap
 * still bounds both together, through the shared guard.
 */
export const CATCH_UP_SHARE = 0.5

/**
 * The day's re-run debounce (lane 0198). The scheduler ticks every ten minutes,
 * and since v0.12.6 anything ingested made today due, so a busy day was distilled
 * again and again at the price of the whole day each time (22,571 tokens for 2-3
 * new items). A scheduled tick now re-reads today only when the last run left
 * `DEBOUNCE_MIN_UNITS` units unread — a backlog it could not finish — or when
 * what waits has waited `DEBOUNCE_MAX_WAIT_MS`. Nothing is lost: the day's last
 * run and the next day's catch-up still read every unit, a person's own
 * `routines.run` never passes through the queue, and neither does a run the
 * provider asked to put off.
 */
export const DEBOUNCE_MIN_UNITS = 5
export const DEBOUNCE_MAX_WAIT_MS = 60 * 60 * 1000

export class RoutineError extends Error {
  constructor(status, code, message, next) {
    super(message)
    this.name = "RoutineError"
    this.status = status
    this.code = code
    this.next = next
  }
}

/**
 * The routines' settings from the environment (§2.1). Their keys can come
 * from `RECORDS_CORE_KEY_FILE` and `RECORDS_LLM_KEY_FILE`, which win (#39); the
 * service passes an environment where they are already read in, so a file is
 * read once.
 */
export function configFromEnv(raw = process.env) {
  const env = resolveSecretFiles(raw, ["RECORDS_CORE_KEY", "RECORDS_LLM_KEY"]).env
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== "" ? Number(v) : d)
  // A whole number in range, or a startup refusal naming the variable: the
  // records service's own settings check their values the same way.
  const whole = (name, fallback, min, max) => {
    const value = env[name]
    if (value === undefined || value === "") return fallback
    const n = Number(value)
    if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${name} must be a whole number from ${min} to ${max}; got ${JSON.stringify(value)}`)
    return n
  }
  return {
    routines: String(env.RECORDS_ROUTINES ?? "off").toLowerCase() === "on",
    routineHour: num(env.RECORDS_ROUTINE_HOUR, 18),
    budgetTokens: num(env.RECORDS_BUDGET_TOKENS, 150_000),
    // One extraction call: its DATA size, and its output cap (records/README.md).
    batchChars: whole("RECORDS_ROUTINE_BATCH_CHARS", 24_000, 1_000, 1_000_000),
    maxOutputTokens: whole("RECORDS_ROUTINE_MAX_OUTPUT_TOKENS", 4_000, 256, 200_000),
    // Service-wide: every space's routine tokens in one UTC day (FABLE records #5).
    serviceBudgetTokens: num(env.RECORDS_SERVICE_BUDGET_TOKENS, 3_000_000),
    // Consecutive failed model calls after which the routines stop calling it for an hour.
    breakerFailures: num(env.RECORDS_LLM_BREAKER_FAILURES, 5),
    // The longest run: past it a run stops calling the model; a `running` row twice as old was interrupted (FABLE records #6).
    maxRunMs: num(env.RECORDS_ROUTINE_MAX_RUN_MINUTES, 60) * 60_000,
    // How far back the catch-up queue looks (FINDINGS R6): the events' own
    // retention window, because a day whose events are gone has nothing to read.
    catchUpDays: whole("RECORDS_EVENT_RETENTION_DAYS", 30, 1, 3650),
    // "propose" (default): decisions, facts, preferences and commitments wait for review; "auto": the policy table applies them.
    apply: applyMode(env.RECORDS_ROUTINE_APPLY),
    proposalTtlDays: num(env.RECORDS_PROPOSAL_TTL_DAYS, 30),
    // The trait gate's tier (design §5.4): its own breaker, never the shared one.
    traitBreakerFailures: num(env.RECORDS_TRAIT_BREAKER_FAILURES, 3),
    traitBreakerCooldownMs: num(env.RECORDS_TRAIT_BREAKER_COOLDOWN_MINUTES, 60) * 60_000,
    llm: { url: env.RECORDS_LLM_URL ?? "", model: env.RECORDS_LLM_MODEL ?? "", key: env.RECORDS_LLM_KEY ?? "" },
    core: { url: env.RECORDS_CORE_URL ?? "", key: env.RECORDS_CORE_KEY ?? "", serviceId: env.RECORDS_CORE_SERVICE_ID ?? "" },
  }
}

function newRunId(ms) {
  return `run_${ms.toString(36)}${randomBytes(6).toString("hex")}`
}

/**
 * A space as `listSpaces()` names it: a space id, or its meta
 * `{space, team, space_kind, owner_user, service, tz?}` (the store's `meta()`; older
 * `service_id` and camelCase names are read too).
 */
export function normaliseSpace(entry) {
  if (typeof entry === "string") return { spaceId: entry, team: null, kind: null, ownerUser: null, tz: null, serviceId: null }
  return {
    spaceId: String(entry?.space ?? entry?.spaceId ?? entry?.id),
    team: entry?.team ?? null,
    kind: entry?.space_kind ?? entry?.spaceKind ?? entry?.kind ?? null,
    ownerUser: entry?.owner_user ?? entry?.ownerUser ?? null,
    tz: entry?.tz ?? null,
    serviceId: entry?.service ?? entry?.service_id ?? entry?.serviceId ?? null,
  }
}

/**
 * The core scope of a space's turns: `{teamId, userId?, serviceId?}`, or null
 * when the space cannot be read safely (no container, a personal space whose
 * owner is unknown, or **a shared space**, whose turns belong to its members).
 *
 * A shared space's container holds every member's team-captured turns, and the
 * routine would put them into one prompt and quote them back to every viewer.
 * No decision allowed that, so a shared space's turns are not read at all: its
 * events and records still feed its journal
 * (docs/design/adr-team-capture-routine.md, audit-reports/routine-privacy).
 */
export function coreScopeOf(sp, fallbackServiceId = "") {
  const serviceId = sp.serviceId || fallbackServiceId || null
  const service = serviceId ? { serviceId } : {}
  if (!sp.team) return null
  // A shared space's turns are not read (0.15.1): see the note above.
  if (sp.kind === "shared") return null
  if (sp.kind === "personal" && sp.ownerUser) return { teamId: sp.team, userId: sp.ownerUser, ...service }
  return null
}

/**
 * Union of captured agents and record authors, scoped to this space.
 */
export async function seenPairs(space, actor) {
  const pairs = []
  const seen = new Set()
  const add = (user, agent) => {
    if (!agent || !user || user === ROUTINE_USER) return
    const key = `${user}\0${agent}`
    if (seen.has(key)) return
    seen.add(key)
    pairs.push({ userId: String(user), agentId: String(agent) })
  }
  if (typeof space.routineAgents === "function") {
    for (const pair of await space.routineAgents(actor)) add(pair.user, pair.agent)
  }
  let cursor = null
  // The store rejects a limit above 200. Page until the cursor is exhausted so
  // an agent named only on an older record is still queried.
  do {
    const page = await space.list({ status: "all", limit: 200, cursor }, actor)
    for (const record of page.records ?? []) {
      const agent = record.author?.agent
      const user = record.author?.user
      add(user, agent)
    }
    cursor = page.cursor ?? null
  } while (cursor)
  return pairs
}

function semaphore(max) {
  let active = 0
  const waiting = []
  return {
    async acquire() {
      if (active < max) {
        active += 1
        return
      }
      await new Promise((resolve) => waiting.push(resolve))
      active += 1
    },
    release() {
      active -= 1
      const next = waiting.shift()
      if (next) next()
    },
    get active() {
      return active
    },
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * @param {object} options
 * @param {{forSpace(spaceId: string): any, listSpaces(): Promise<any[]>}} options.store
 * @param {ReturnType<typeof configFromEnv> & {tickMs?: number, maxConcurrent?: number, staggerMs?: number, costPer1kTokens?: number}} options.config
 * @param {any} [options.log]
 * @param {() => Date} [options.now]
 * @param {() => Promise<any[]>} [options.listSpaces] defaults to `store.listSpaces()`
 * @param {any} [options.llm] a createLlm() instance (tests pass a fake)
 * @param {any} [options.guard] the shared per-space model budget and breaker
 *   (`records/src/model-guard.js`); the service passes the one the job runner
 *   has too, and without it the routines make their own
 * @param {any} [options.core] a createCoreReader() instance (tests pass a fake)
 * @param {typeof fetch} [options.fetchImpl]
 * @param {object} [options.deps] passed to the daily routine (mutation tests)
 */
export function createRoutines(options) {
  const { store, log } = options
  const config = {
    tickMs: 600_000,
    maxConcurrent: 2,
    staggerMs: 15_000,
    serviceBudgetTokens: 3_000_000,
    breakerFailures: 5,
    breakerCooldownMs: 3_600_000,
    maxRunMs: 3_600_000,
    ...(options.config ?? {}),
  }
  const now = options.now ?? (() => new Date())
  /** The engine's status, when the service loaded one beside the routines (S3c). */
  const engineStatus = typeof options.engine === "function" ? () => {
    try {
      const status = options.engine()?.status?.()
      return status ? { paused: status.paused ?? null, version: status.version ?? [] } : null
    } catch {
      return null
    }
  } : null
  const listSpaces = options.listSpaces ?? (() => store.listSpaces())
  const rawLlm = options.llm ?? createLlm({ ...config.llm, fetchImpl: options.fetchImpl, costPer1kTokens: config.costPer1kTokens, log })

  // One model budget and one breaker per space, shared with the job runner
  // (0.11, records/src/model-guard.js): a routine's call and a job's call count
  // against the same day's tokens and the same breaker. Passed in by the
  // service, so both runners hold the one object; a caller with neither gets
  // its own, which is what the tests and a solo build do.
  const guard =
    options.guard ??
    createModelGuard({
      store,
      now,
      log,
      config: {
        limit: config.budgetTokens,
        breakerFailures: config.breakerFailures,
        breakerCooldownMs: config.breakerCooldownMs,
        cellWindow: config.cellWindow,
        cellRatio: config.cellRatio,
      },
    })
  /**
   * The client one run calls: every call passes the guard first, so the space's
   * routines and its jobs never pass the one budget, or call while the one
   * breaker is open.
   */
  const llmFor = (spaceId, day, tz) => ({
    available: rawLlm.available,
    model: rawLlm.model,
    complete: (input) =>
      guard.complete(spaceId, () => rawLlm.complete({ ...input, space: spaceId }), { day, tz, tokens: estimateTokens(input.system) + estimateTokens(input.user) + (input.maxTokens ?? 4000) }),
  })
  const llm = {
    get available() {
      return rawLlm.available
    },
    model: rawLlm.model,
  }

  /**
   * The trait gate's client and breaker (design §5.4). Its classifier is a
   * small tier with its own state: a classifier failure must never open the
   * breaker the routines and the jobs share, so this client skips the guard,
   * and the daily charges its tokens to the run instead. Its breaker is one per
   * space and it is carried across runs, so a struggling classifier is not
   * retried on every run.
   */
  const traitLlmFor = (spaceId, day, tz) => ({
    get available() {
      return rawLlm.available
    },
    model: rawLlm.model,
    complete: async (input) => {
      // The cell's own guard, so an outage that opened it stops the classifier
      // too: the day's titles are then judged by the lexicon, and its claims
      // wait (design §10.4).
      const state = await guard.state(spaceId, { day, tz })
      if (state?.breaker) throw new LlmError("the model's breaker is open in this space", { status: 0, code: "llm_breaker" })
      // The cell's breaker too (review M3): an outage that opened it must stop
      // the classifier in every space, or it makes one failing call per space,
      // which is what the cell breaker exists to prevent (design §10.4).
      if (state?.cell_breaker) throw new LlmError(`the model failed across the cell; the classifier calls it again after ${state.cell_breaker}`, { status: 0, code: "llm_breaker", cell: true })
      return rawLlm.complete({ ...input, space: spaceId })
    },
  })
  // One breaker for the trait tier of this cell, not one per space (design
  // §10.4): an outage must not make one failing call per space.
  const traitBreaker =
    options.traitBreaker ??
    traitBreakerOfCell({
      failures: Number.isFinite(config.traitBreakerFailures) ? config.traitBreakerFailures : 3,
      cooldownMs: Number.isFinite(config.traitBreakerCooldownMs) ? config.traitBreakerCooldownMs : 60_000,
    })

  // The service-wide daily budget: the ledgers' tokens since UTC midnight,
  // read once a day, plus what the runs in flight spent since.
  const service = { day: null, base: 0, active: new Map(), seeding: null }
  async function serviceBudget() {
    const day = now().toISOString().slice(0, 10)
    if (service.day !== day) {
      if (!service.seeding) {
        service.seeding = (async () => {
          let base = 0
          for (const entry of await listSpaces()) {
            const sp = normaliseSpace(entry)
            const space = store.forSpace(sp.spaceId)
            if (typeof space.runTokens === "function") base += (await space.runTokens({ since: `${day}T00:00:00.000Z` }, actorFor(sp))).tokens
          }
          service.base = base
          for (const [run] of service.active) service.active.set(run, run.tokens)
          service.day = day
        })().finally(() => {
          service.seeding = null
        })
      }
      await service.seeding
    }
    return {
      limit: config.serviceBudgetTokens,
      used: () => service.base + [...service.active].reduce((sum, [run, at]) => sum + Math.max(0, run.tokens - at), 0),
    }
  }

  /**
   * Days that ran today and read nothing, so they cannot progress on today's
   * allowance: the queue steps past them and `routines.status` shows them
   * (review finding H4). A new local day clears them by being a new day.
   */
  const stuck = new Map()
  const stuckOf = (spaceId) => {
    let entry = stuck.get(spaceId)
    if (!entry) {
      entry = new Map()
      stuck.set(spaceId, entry)
    }
    return entry
  }

  // One routine at a time per space, manual or scheduled (FABLE records #5).
  const locks = new Map()
  async function withSpaceLock(spaceId, fn) {
    const prev = locks.get(spaceId) ?? Promise.resolve()
    let release
    const mine = new Promise((resolve) => {
      release = resolve
    })
    const chained = prev.then(() => mine)
    locks.set(spaceId, chained)
    await prev
    try {
      return await fn()
    } finally {
      release()
      if (locks.get(spaceId) === chained) locks.delete(spaceId)
    }
  }
  const core = options.core ?? createCoreReader({ ...config.core, fetchImpl: options.fetchImpl })
  const slots = semaphore(Math.max(1, config.maxConcurrent))
  const inFlight = new Map()
  let timer = null
  let ticking = null
  let stopped = false
  let lastStart = 0

  // autoApply: in auto mode the policy table applies the person's own
  // statements as theirs; the store keeps stated_by person from this actor
  // only then (model.js mayStatePerson).
  const actorFor = (sp) => ({ user: ROUTINE_USER, agent: ROUTINE_AGENT, session: null, role: "owner", grants: [], space: sp.spaceId, spaceKind: sp.kind ?? undefined, team: sp.team ?? undefined, autoApply: applyMode(config.apply) === "auto" })

  /** The core scope, with the agents this space has named on its records. */
  async function scopeWithAgents(sp, space, actor) {
    const scope = coreScopeOf(sp, config.core?.serviceId)
    if (!scope) return null
    const pairs = await seenPairs(space, actor)
    const listed = typeof core.agents === "function" ? await core.agents(scope) : []
    if (scope.userId) {
      const own = pairs.filter((pair) => pair.userId === scope.userId).map((pair) => pair.agentId)
      return { ...scope, agents: [...new Set([...own, ...listed])] }
    }
    const shared = [...pairs]
    for (const agentId of listed) if (!shared.some((pair) => pair.agentId === agentId)) shared.push({ userId: null, agentId })
    return { ...scope, pairs: shared.filter((pair) => pair.userId && pair.agentId) }
  }

  /** Fills a space's container, kind and owner from its meta where missing. */
  async function resolve(entry) {
    const sp = normaliseSpace(entry)
    if (!sp.team || !sp.kind || !sp.serviceId || (sp.kind === "personal" && !sp.ownerUser)) {
      const meta = typeof store.forSpace(sp.spaceId).meta === "function" ? await store.forSpace(sp.spaceId).meta() : {}
      sp.team = sp.team ?? meta?.team ?? null
      sp.kind = sp.kind ?? meta?.space_kind ?? null
      sp.ownerUser = meta?.owner_user ?? sp.ownerUser ?? null
      sp.serviceId = sp.serviceId || meta?.service || null
    }
    return sp
  }

  async function spaceInfo(sp, space, actor) {
    const { records } = await space.get({ paths: ["index"] }, actor)
    const index = records[0] ?? null
    const tz = safeTz(index?.fields?.tz ?? sp.tz ?? "UTC")
    const owner = sp.kind === "shared" ? { user: null, label: "the team", shared: true } : { user: sp.ownerUser ?? null, label: index?.fields?.name ?? null }
    return { index, tz, owner }
  }

  async function stagger() {
    if (!config.staggerMs) return
    const wait = lastStart + config.staggerMs - Date.now()
    lastStart = Math.max(Date.now(), lastStart + config.staggerMs)
    if (wait > 0) await sleep(wait)
  }

  /** One routine for one space, recorded in the space's run ledger; one at a time per space. */
  function execute(sp, routine, date, trigger, requestedBy, opts = {}) {
    return withSpaceLock(sp.spaceId, () => executeLocked(sp, routine, date, trigger, requestedBy, opts))
  }

  async function executeLocked(sp, routine, date, trigger, requestedBy, opts = {}) {
    const space = store.forSpace(sp.spaceId)
    const actor = actorFor(sp)
    const info = await spaceInfo(sp, space, actor)
    const started = now()
    const catchUp = opts.catchUp === true
    const run = {
      id: newRunId(started.getTime()),
      routine,
      date,
      version: VERSIONS[routine],
      status: "running",
      // A catch-up run of an older day is marked: the console and the tests can
      // tell it from the day's own run, and it draws at most its share.
      ...(catchUp ? { catch_up: true } : {}),
      budget_day: localDay(started, info.tz),
      tokens: 0,
      cost: 0,
      calls: 0,
      started: started.toISOString(),
      ended: null,
      error: null,
      trigger,
      requested_by: requestedBy ?? null,
      result: null,
    }
    const saveRun = async () => {
      await space.putRun({ run }, actor)
    }
    const t0 = performance.now()
    await saveRun()
    try {
      let result
      if (routine === "daily") {
        // A caught-up day draws at most half of the day it spends on, **in all**:
        // what earlier catch-up runs of this day spent comes off its share, so
        // repeated ticks cannot eat the day the person's own reading needs
        // (review finding H5).
        let allowance
        if (catchUp) {
          const half = Math.floor(config.budgetTokens * CATCH_UP_SHARE)
          const { start, end } = dayBounds(run.budget_day, info.tz)
          const spent = typeof space.catchUpTokens === "function" ? (await space.catchUpTokens({ from: start, to: end }, actor)).tokens : 0
          allowance = Math.max(0, half - spent)
        }
        const budget = await openBudget({
          space,
          actor,
          day: run.budget_day,
          tz: info.tz,
          limit: config.budgetTokens,
          allowance,
          run,
          service: await serviceBudget(),
        })
        service.active.set(run, run.tokens)
        const coreScope = await scopeWithAgents(sp, space, actor)
        if (!coreScope && core.available) {
          emit(log, "warn", {
            event: "memory.routine.config",
            team: sp.spaceId,
            reason: sp.kind === "shared" ? "a shared space's conversation turns are not read" : "the space's container or owner is unknown: its turns are not read",
          })
        }
        result = await runDaily({
          space,
          actor,
          spaceId: sp.spaceId,
          spaceKind: sp.kind,
          coreScope,
          day: date,
          tz: info.tz,
          owner: info.owner,
          llm: llmFor(sp.spaceId, run.budget_day, info.tz),
          traitLlm: traitLlmFor(sp.spaceId, run.budget_day, info.tz),
          traitBreaker,
          now,
          core,
          budget,
          run,
          saveRun,
          config,
          log,
          catchUp,
          ranOn: localDay(started, info.tz),
          now,
          deps: options.deps,
        })
      } else if (routine === "weekly" || routine === "monthly") result = await runRollup(space, actor, routine, date, run)
      else if (routine === "lint") result = await runLint(space, actor, date, info.tz, run)
      else result = await runDashboard(space, actor, date, info.tz)
      run.status = result.status ?? "ok"
      run.error = result.error ?? null
      const { decided: _d, ...summary } = result
      run.result = summary
    } catch (error) {
      run.status = "failed"
      // The model's own words (`llm.js` carries the provider's answer): a
      // provider's error can quote a key or a URL with a token, and this text
      // is kept in the ledger and shown by four surfaces (0.11 review, round 3).
      run.error = errorText(String(error?.message ?? error), 500)
    }
    // Before the ledger write and every reader: the error the routine returned
    // is the same third-party text, in the run and in its summary.
    if (run.error) run.error = errorText(String(run.error), 500)
    if (run.result && typeof run.result.error === "string" && run.result.error) run.result = { ...run.result, error: errorText(run.result.error, 500) }
    if (service.active.has(run)) {
      if (service.day) service.base += Math.max(0, run.tokens - service.active.get(run))
      service.active.delete(run)
    }
    run.ended = now().toISOString()
    await saveRun().catch((error) => emit(log, "error", { event: "memory.routine.ledger", team: sp.spaceId, run: run.id, error: errorText(String(error?.message ?? error), 200) }))
    if (ALERT_OUTCOMES.includes(run.status)) {
      // One alert line per actual run; a skipped run (a quiet day, an edited
      // journal) did nothing and logs only a debug line.
      if (run.status === "failed") emit(log, "error", { event: "memory.routine.error", team: sp.spaceId, routine, date, run: run.id, error: run.error })
      emit(log, run.status === "failed" ? "error" : run.status === "budget" ? "warn" : "info", runLine({ status: run.status, routine, teamId: sp.spaceId, tokens: run.tokens, ms: performance.now() - t0 }))
    } else emit(log, "debug", { event: "memory.routine.tick", team: sp.spaceId, routine, date, status: run.status, reason: run.result?.reason ?? null })
    return run
  }

  /** A daily journal, then lint and the dashboard (§5). */
  async function dailyChain(sp, date, trigger, requestedBy, opts = {}) {
    const daily = await execute(sp, "daily", date, trigger, requestedBy, opts)
    if (daily.status !== "skipped" || daily.result?.journal) {
      await execute(sp, "lint", date, trigger, requestedBy)
      await execute(sp, "dashboard", date, trigger, requestedBy)
    }
    return daily
  }

  async function runRollup(space, actor, routine, date, run) {
    const days = routine === "weekly" ? weekDays(date) : monthDays(date)
    const { records: journals } = await space.get({ paths: days.map((d) => `journal/${d}`) }, actor)
    const commitments = await readAll(space, actor).then((all) => all.filter((r) => r.kind === "commitment"))
    const page = renderRollup({ kind: routine, day: date, journals, openCommitments: commitments, version: VERSIONS[routine], runId: run.id })
    const { records: [current] = [] } = await space.get({ paths: [page.path] }, actor)
    if (current && (current.fields?.edited === true || !current.fields?.routine)) return { status: "skipped", reason: "the rollup was edited by a person", journal: page.path }
    if (journals.length === 0) return { status: "skipped", reason: "no daily journals in the period" }
    if (current) await space.put({ record: { id: current.id, base_version: current.version, title: page.title, body: page.body, fields: page.fields } }, actor)
    else await space.put({ record: { kind: "page", type: "journal", path: page.path, title: page.title, body: page.body, stated_by: "agent", source: { routine: VERSIONS[routine] }, fields: page.fields } }, actor)
    return { status: "ok", journal: page.path, counts: { journals: journals.length } }
  }

  async function runLint(space, actor, date, tz, run) {
    const records = await readAll(space, actor, { status: "all" })
    const { findings, contradictions } = lintRecords(records, { day: date, tz })
    const { records: existing } = await space.list({ kind: "proposal", status: "all", limit: 200, full: false }, actor)
    const keys = new Set(existing.map((p) => p.fields?.routine_key).filter(Boolean))
    let proposals = 0
    let skipped = 0
    for (const { a, b } of contradictions) {
      const key = `lint:${[a.id, b.id].sort().join("|")}`
      if (keys.has(key)) continue
      try {
        await space.put(
          {
            record: {
              kind: "proposal",
              type: "supersede",
              title: `contested: ${b.title}`.slice(0, 200),
              body: `[[${b.id}]] disagrees with [[${a.id}]]. Accepting marks [[${b.id}]] contested until a person settles it.`,
              status: "proposed",
              stated_by: "inferred",
              source: { routine: VERSIONS.lint },
              fields: { action: "supersede", target_id: b.id, reason: "contradiction found by lint", evidence: [{ record: a.id, quote: a.title }, { record: b.id, quote: b.title }], payload: { mode: "contest", against: a.id }, expires: new Date(Date.parse(`${addDays(date, (config.proposalTtlDays ?? 30) + 1)}T00:00:00Z`)).toISOString(), routine: VERSIONS.lint, routine_key: key },
            },
          },
          actor,
        )
        proposals += 1
      } catch (error) {
        // A person deleted this contest proposal: the store keeps a tombstone on
        // its key and refuses the write. The night does not retry it; the
        // findings and the run stay, and the skip is counted (FINDINGS R4).
        if (error?.code !== "forgotten") throw error
        keys.add(key)
        skipped += 1
      }
    }
    run.result = { findings }
    return { status: "ok", findings, counts: { findings: findings.length, proposals, skipped } }
  }

  /** The records whose title or text copies nothing a person forgot. */
  async function notForgotten(space, actor, records) {
    if (records.length === 0 || typeof space.routineCheck !== "function") return records
    const { blocked = [] } = await space.routineCheck({ items: records.map((r) => ({ texts: [r.title ?? "", r.fields?.what ?? ""] })) }, actor)
    const out = new Set(blocked.map((b) => b.index))
    return records.filter((_, i) => !out.has(i))
  }

  async function runDashboard(space, actor, date, tz) {
    const { records: [index] = [] } = await space.get({ paths: ["index"] }, actor)
    const [{ runs: lintRuns }, all, { proposals }, { records: journal }] = await Promise.all([
      space.listRuns({ routine: "lint", limit: 1 }, actor),
      readAll(space, actor),
      space.listProposals({ limit: 100 }, actor),
      space.get({ paths: [`journal/${date}`] }, actor),
    ])
    const since = addDays(date, -14)
    // The dashboard is pinned: a line that copies text a person forgot is
    // withheld (routine-safety review, item 3), checked as the daily's items are.
    const shown = await notForgotten(space, actor, all.filter((r) => (r.kind === "page" && r.type === "project") || r.kind === "commitment" || (r.kind === "memory" && r.type === "decision")))
    const projects = shown
      .filter((r) => r.kind === "page" && r.type === "project")
      .sort((a, b) => (b.updated < a.updated ? -1 : 1))
    const active = projects.filter((p) => p.updated.slice(0, 10) >= since)
    const block = (outside) =>
      renderDashboard({
        day: date,
        tz,
        goals: Array.isArray(index?.fields?.goals) ? index.fields.goals : [],
        projects: (active.length ? active : projects).slice(0, 8),
        commitments: shown.filter((r) => r.kind === "commitment"),
        decisions: shown.filter((r) => r.kind === "memory" && r.type === "decision" && r.created.slice(0, 10) >= since).sort((a, b) => (b.created < a.created ? -1 : 1)).slice(0, 8),
        proposals,
        findings: lintRuns[0]?.result?.findings ?? [],
        outside,
        latestJournal: journal.length ? `journal/${date}` : null,
      })
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const { records: [current] = [] } = attempt === 0 ? { records: index ? [index] : [] } : await space.get({ paths: ["index"] }, actor)
      try {
        if (current) {
          const { before, after } = splitDashboard(current.body)
          const outside = [before, after].filter(Boolean).join("\n")
          const body = mergeDashboard(current.body, block(outside))
          if (body === current.body) return { status: "ok", counts: { lines: body.split("\n").length } }
          await space.put({ record: { id: current.id, base_version: current.version, body } }, actor)
          return { status: "ok", counts: { lines: body.split("\n").length } }
        }
        const body = [OPEN, ...block(""), CLOSE].join("\n")
        await space.put({ record: { kind: "page", type: "index", path: "index", title: "Dashboard", body, stated_by: "agent", source: { routine: VERSIONS.dashboard }, fields: { routine: VERSIONS.dashboard, tz } } }, actor)
        return { status: "ok", counts: { lines: body.split("\n").length } }
      } catch (error) {
        const retry = error?.code === "version_conflict" || error?.code === "path_taken" || error?.status === 409
        if (!retry || attempt === 1) throw error
      }
    }
    return { status: "ok" }
  }

  /** Run with a slot; one run per (space, routine, date) at a time. */
  async function withSlot(key, fn) {
    if (inFlight.has(key)) return inFlight.get(key)
    const promise = (async () => {
      await slots.acquire()
      try {
        await stagger()
        return await fn()
      } finally {
        slots.release()
      }
    })()
    inFlight.set(key, promise)
    try {
      return await promise
    } finally {
      inFlight.delete(key)
    }
  }

  /**
   * `routines.run`: `actor` is the caller (§2.5), whose `team` and `spaceKind`
   * come from the gateway; the space's meta supplies the owner.
   */
  async function run(spaceId, routine, date, actor) {
    if (!ROUTINES.includes(routine)) throw new RoutineError(400, "invalid_routine", `Unknown routine ${routine}.`, `Use one of ${ROUTINES.join(", ")}.`)
    if (!["admin", "owner"].includes(actor?.role)) throw new RoutineError(403, "forbidden", "Running a routine needs admin or owner access to the space.", "Ask the space's owner.")
    if (date != null && !isDay(date)) throw new RoutineError(400, "invalid_date", `The date ${date} is not YYYY-MM-DD.`, "Send a date such as 2026-11-08, or leave it out for today.")
    const meta = await resolve(spaceId)
    const sp = {
      ...meta,
      team: actor?.team ?? meta.team,
      kind: actor?.spaceKind ?? meta.kind,
      // A personal space's owner is its meta's; the caller only fills a gap.
      ownerUser: meta.ownerUser ?? ((actor?.spaceKind ?? meta.kind) === "personal" && actor?.user && actor.user !== ROUTINE_USER ? actor.user : null),
      tz: actor?.tz ?? null,
      // The caller's service is not the space's. A scheduled run has none;
      // a manual run must not query a different cell than the one that
      // wrote the space. meta.service wins; the env id is only a fallback.
      serviceId: meta.serviceId || config.core?.serviceId || null,
    }
    const space = store.forSpace(sp.spaceId)
    const { tz } = await spaceInfo(sp, space, actorFor(sp))
    const day = date ?? localDay(now(), tz)
    if (!llm.available && routine === "daily") emit(log, "warn", { event: "memory.routine.config", team: sp.spaceId, reason: "no model is configured: the journal is written without extraction" })
    const result = await withSlot(`${sp.spaceId}|${routine}|${day}`, () =>
      routine === "daily" ? dailyChain(sp, day, "manual", actor?.user) : execute(sp, routine, day, "manual", actor?.user),
    )
    return { run: publicRun(result) }
  }

  function publicRun(r) {
    return { id: r.id, routine: r.routine, date: r.date, version: r.version, status: r.status, tokens: r.tokens, cost: r.cost, started: r.started, ended: r.ended, error: r.error, result: r.result }
  }

  async function status(spaceId) {
    const sp = normaliseSpace(spaceId)
    const space = store.forSpace(sp.spaceId)
    const { runs } = await space.listRuns({ limit: 50 }, actorFor(sp))
    // The one breaker and the one budget this space's routines **and its jobs**
    // share (0.11), for the space's own local day; a read that fails shows
    // neither rather than failing status.
    const { tz } = await spaceInfo(sp, space, actorFor(sp)).catch(() => ({ tz: "UTC" }))
    const shared = await guard.state(sp.spaceId, { day: localDay(now(), tz), tz }).catch(() => null)
    return {
      // Whether the scheduler runs here, and with which model: without both, collected events only wait out their 30 days.
      scheduled: Boolean(config.routines) && Boolean(llm.available),
      model: config.llm?.model || null,
      hour: Number.isFinite(config.routineHour) ? config.routineHour : null,
      // The breaker is one per space, routines and jobs together: open until
      // this instant, or null. `cell_breaker` is the provider's, shared by every
      // space of the cell (scale H5). `budget` is the day's spend from both ledgers.
      breaker: shared?.breaker ?? null,
      cell_breaker: shared?.cell_breaker ?? null,
      ...(shared ? { budget: { limit: shared.limit, day: shared.budget.day, used: shared.budget.used, routines: shared.budget.routines, jobs: shared.budget.jobs } } : {}),
      runs: runs.map((r) => ({ routine: r.routine, date: r.date, status: r.status, tokens: r.tokens, cost: r.cost, started: r.started, ended: r.ended, error: r.error })),
      // The days a backlog cannot read today: a day that ran and read nothing.
      stuck: [...(stuck.get(sp.spaceId)?.values() ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1)),
      // The trait gate's queue (design §5.4): a claim its classifier could not
      // answer waits here and the next run retries it; past its attempts it is
      // stuck, and health says so rather than the queue growing unseen.
      traits: await traitQueue(space, actorFor(sp)),
      // The engine's own pauses (S3c): a paused engine or a paused digest, with
      // its class and next probe. Absent on a build with no engine.
      ...(engineStatus ? { engine: engineStatus() } : {}),
    }
  }

  /**
   * What the trait gate still owes: how many claims wait on its classifier, and
   * how long the oldest has waited, so a long pause is visible rather than
   * silent. A read that fails shows none rather than failing status.
   */
  async function traitQueue(space, actor) {
    if (typeof space.listTraitHolds !== "function") return { pending: 0, oldest: null, age_ms: null }
    try {
      const { holds } = await space.listTraitHolds({ limit: 2_000 }, actor)
      const oldest = holds[0]?.created ?? null
      const age = oldest ? Math.max(0, now().getTime() - Date.parse(oldest)) : null
      return { pending: holds.length, oldest, age_ms: Number.isFinite(age) ? age : null }
    } catch {
      return { pending: 0, oldest: null, age_ms: null }
    }
  }

  /**
   * New activity in a space since an instant: turns, records (not the routines'
   * own) or events, **by arrival**. An event is new when it was ingested after
   * the run, whatever `occurred_at` says: a message collected hours late is
   * still today's work (FINDINGS R6).
   *
   * Imported history is not: an anchor or an import (0.15.12's `events.history`)
   * arrives now but occurred before the live window, and the daily never journals
   * it as a day's work (lane 0195b). Counting it here made an import buy one
   * wasted run an hour while it arrived, so it is left out of the probe and a
   * genuine late arrival still wakes the day (lane 0198, review).
   *
   * Only whether anything arrived: the debounce's wait is measured from when the
   * last run started looking, not from how many items have since collected, so a
   * mailbox polled every ten minutes cannot buy a run every twenty-five by
   * arriving in twos (lane 0198).
   */
  async function activitySince(sp, space, actor, since) {
    const until = now().toISOString()
    const { records } = await space.list({ updated_after: since, limit: 50 }, actor)
    if (records.some((r) => r.author?.agent !== ROUTINE_AGENT && r.source?.routine == null)) return true
    const { events } = await space.listEvents({ ingested_after: since, limit: 1, exclude_history: true }, actor)
    if (events.length > 0) return true
    const scope = await scopeWithAgents(sp, space, actor)
    return core.available && scope ? core.any({ ...scope, start: since, end: until }) : false
  }

  /**
   * Is today's last run's work enough to buy another run, or young enough to
   * wait (lane 0198)? The day is due when the run left `DEBOUNCE_MIN_UNITS` units
   * unread — a backlog it could not finish — or when what waits has waited
   * `DEBOUNCE_MAX_WAIT_MS`. `dueFor` asks only after a run exists.
   *
   * A run that left no unread units waits from its own `ingested_through`, so a
   * collected item counts from the moment the run started looking, never from
   * when that item happened to be written down (a late arrival is not old).
   * A run that left unread units waits from its end: they were its own next
   * step, and they are not dropped while they wait — the day's last run and the
   * next day's catch-up still read them.
   */
  async function reRunWaits(sp, space, actor, prev, at) {
    // A run the provider asked to put off (a 429, the cell breaker) is retried at
    // the next tick as it always was: the debounce is about ordinary arrivals,
    // not a pause the run itself says will pass. The run records that in
    // `result.retry`; the queue reads the code, never the reason's words.
    if (prev.status === "skipped" && prev.result?.retry === RETRY_NEXT_TICK) return true
    const unread = Number(prev.result?.counts?.unread) || 0
    // A backlog the last run could not finish: continue without waiting.
    if (unread >= DEBOUNCE_MIN_UNITS) return true
    const lookedFrom = prev.result?.ingested_through ?? prev.ended ?? prev.started
    // Nothing was left unread and nothing has arrived: the day is done.
    if (unread === 0 && !(await activitySince(sp, space, actor, lookedFrom))) return false
    const waitedFrom = Date.parse(unread > 0 ? (prev.ended ?? prev.started) : lookedFrom) || at.getTime()
    return at.getTime() - waitedFrom >= DEBOUNCE_MAX_WAIT_MS
  }

  /** What is due for one space now: [{routine, date}] in order. */
  async function dueFor(sp) {
    const space = store.forSpace(sp.spaceId)
    const actor = actorFor(sp)
    const { tz } = await spaceInfo(sp, space, actor)
    const at = now()
    const today = localDay(at, tz)
    const hour = localHour(at, tz)
    const jobs = []
    const last = async (routine, date) => (await space.listRuns({ routine, date, limit: 1 }, actor)).runs[0] ?? null
    const journalEdited = async (date) => {
      const { records: [j] = [] } = await space.get({ paths: [`journal/${date}`] }, actor)
      return Boolean(j && (j.fields?.edited === true || !j.fields?.routine))
    }

    // A `running` row older than twice the longest run is a run a restart
    // interrupted: it is marked failed, and its day runs again.
    const lastLive = async (routine, date) => {
      const r = await last(routine, date)
      if (r?.status !== "running" || Date.parse(r.started) >= at.getTime() - 2 * config.maxRunMs) return r
      // A run of this space in flight in this process is not stale, however long it takes.
      if (locks.has(sp.spaceId)) return r
      const failed = { ...r, status: "failed", ended: at.toISOString(), error: "interrupted: the run never finished (a restart?)" }
      await space.putRun({ run: failed }, actor)
      emit(log, "warn", { event: "memory.routine.stale", team: sp.spaceId, routine, date, run: r.id })
      return { ...failed, stale: true }
    }

    const yesterday = addDays(today, -1)
    // The day queue (FINDINGS R6, §7.2): a past day still has unread units when
    // it never ran, its last run failed, or it ended with unread units (a budget
    // stop, a time limit). One day per tick, oldest first, so a backlog drains
    // in order and a day that resumes is never re-read whole.
    const windowStart = addDays(today, -Math.max(1, Number.isFinite(config.catchUpDays) ? config.catchUpDays : 30))
    const dayNeedsRun = (run) => {
      if (!run) return true
      if (run.status === "running") return Date.parse(run.started) < at.getTime() - 2 * config.maxRunMs && !locks.has(sp.spaceId)
      if (run.status === "failed") return Date.parse(run.started) < at.getTime() - 3_600_000
      return (Number(run.result?.counts?.unread) || 0) > 0
    }
    const recent = new Map()
    for (const run of (await space.listRuns({ routine: "daily", limit: 200 }, actor)).runs) if (run.date && !recent.has(run.date)) recent.set(run.date, run)
    /**
     * When each UTC day's newest event arrived. A day whose newest arrival is
     * after its last run has an event that run never saw, so it is due again
     * even though it ended clean (FINDINGS R6, the late arrival). One query,
     * and the UTC day is widened to the local days that touch it below.
     */
    const arrivals = new Map()
    if (typeof space.ingestMarks === "function") {
      const { marks = [] } = await space.ingestMarks({ since: dayBounds(windowStart, tz).start }, actor)
      for (const mark of marks) arrivals.set(mark.day, mark.at)
    }
    /** The newest arrival of any UTC day a local day touches. */
    const latestArrival = (day) => {
      const { start, end } = dayBounds(day, tz)
      let at = null
      for (let date = start.slice(0, 10); date <= new Date(Date.parse(end) - 1).toISOString().slice(0, 10); date = addDays(date, 1)) {
        const seen = arrivals.get(date)
        if (seen && (!at || seen > at)) at = seen
      }
      return at
    }
    // The oldest day the queue tries: the earliest day something **that is not history** arrived for (or yesterday, so a quiet
    // yesterday is still tried once). It comes from the marks, not from the earliest event, so an import of past months never pulls the
    // window back over days that hold only imported items (lane 0195b): those days are not late, and no journal is written for them.
    let from = yesterday
    const markDays = [...arrivals.keys()].sort()
    if (markDays.length > 0) {
      const day = localDay(new Date(`${markDays[0]}T00:00:00Z`), tz)
      if (day < from) from = day
    }
    if (from < windowStart) from = windowStart
    for (let day = from; day <= yesterday; day = addDays(day, 1)) {
      if (await journalEdited(day)) continue
      const prev = recent.get(day) ?? null
      // A day whose events arrived after its last run is due again, even when
      // that run ended clean.
      const seenThrough = prev?.result?.ingested_through ?? prev?.ended ?? prev?.started ?? ""
      const arrival = latestArrival(day)
      const late = seenThrough ? (arrival ?? "") > seenThrough : true
      // **A day that never ran is due**, whatever arrived for it (v0.15.11's rule, restored in lane 0195b): a day missed in an outage may
      // hold captured turns and no event at all, and its journal must still be written. Imported history stays out by the marks above —
      // it never makes a day late — and by `from`, so a day that holds only imported items is not queued and no journal is written for it.
      if (!dayNeedsRun(prev) && !late) continue
      // A day that already ran today and read nothing cannot get further on
      // today's allowance. It waits and is reported, and the next day is taken
      // instead, so one day can never hold the queue (review finding H4).
      const readToday = prev ? localDay(new Date(prev.started), tz) === today : false
      if (readToday && (Number(prev.result?.counts?.read) || 0) === 0 && (Number(prev.result?.counts?.unread) || 0) > 0) {
        stuckOf(sp.spaceId).set(day, { date: day, unread: Number(prev.result.counts.unread), since: prev.started })
        continue
      }
      stuckOf(sp.spaceId).delete(day)
      // A stale `running` row is marked failed here, as the day's own run would be.
      if (prev?.status === "running") await lastLive("daily", day)
      jobs.push({ routine: "daily", date: day, catchUp: true })
      break
    }
    if (hour >= config.routineHour && !(await journalEdited(today))) {
      const prev = await lastLive("daily", today)
      if (!prev || prev.stale) jobs.push({ routine: "daily", date: today })
      else if (prev.status === "running") {
        // in flight elsewhere
      } else if (prev.status === "failed") {
        if (Date.parse(prev.started) < at.getTime() - 3_600_000) jobs.push({ routine: "daily", date: today })
      } else if (prev.status !== "budget" && (await reRunWaits(sp, space, actor, prev, at))) jobs.push({ routine: "daily", date: today })
    }
    if (weekday(today) === 1) {
      const lastWeek = addDays(today, -7)
      if (!(await last("weekly", lastWeek))) jobs.push({ routine: "weekly", date: lastWeek })
    }
    if (today.endsWith("-01")) {
      const lastMonth = `${addDays(today, -1).slice(0, 7)}-01`
      if (!(await last("monthly", lastMonth))) jobs.push({ routine: "monthly", date: lastMonth })
    }
    return jobs
  }

  /** One scheduler pass over every space. Resolves when its runs end. */
  async function tick() {
    if (ticking) return ticking
    ticking = (async () => {
      let spaces = []
      try {
        spaces = await Promise.all((await listSpaces()).map(resolve))
      } catch (error) {
        emit(log, "error", { event: "memory.routine.tick", stage: "list", error: errorText(String(error?.message ?? error), 200) })
        return []
      }
      const jobs = []
      for (const sp of spaces) {
        if (stopped) break
        let due = []
        try {
          due = await dueFor(sp)
        } catch (error) {
          emit(log, "error", { event: "memory.routine.tick", stage: "plan", team: sp.spaceId, error: errorText(String(error?.message ?? error), 200) })
          continue
        }
        if (due.length === 0) continue
        // One slot per space: its routines run in order, the dailies first.
        jobs.push(
          withSlot(`${sp.spaceId}|tick`, async () => {
            const done = []
            for (const job of due) {
              if (stopped) break
              done.push(job.routine === "daily" ? await dailyChain(sp, job.date, "schedule", undefined, { catchUp: job.catchUp === true }) : await execute(sp, job.routine, job.date, "schedule"))
            }
            return done
          }),
        )
      }
      const settled = await Promise.allSettled(jobs)
      return settled.flatMap((s) => (s.status === "fulfilled" ? s.value : []))
    })()
    try {
      return await ticking
    } finally {
      ticking = null
    }
  }

  return {
    run,
    status,
    tick,
    /** Starts the 10-minute scheduler when RECORDS_ROUTINES is on and a model is configured. */
    start() {
      stopped = false
      if (!config.routines) {
        emit(log, "info", { event: "memory.routine.config", reason: "RECORDS_ROUTINES is not on" })
        return false
      }
      if (!llm.available) {
        emit(log, "warn", { event: "memory.routine.config", reason: "RECORDS_LLM_URL or RECORDS_LLM_MODEL is not set: routines stay off" })
        return false
      }
      if (timer) return true
      timer = setInterval(() => {
        tick().catch((error) => emit(log, "error", { event: "memory.routine.tick", stage: "tick", error: errorText(String(error?.message ?? error), 200) }))
      }, config.tickMs)
      timer.unref?.()
      return true
    },
    async stop() {
      stopped = true
      if (timer) clearInterval(timer)
      timer = null
      await Promise.allSettled([ticking, ...inFlight.values()].filter(Boolean))
    },
  }
}
