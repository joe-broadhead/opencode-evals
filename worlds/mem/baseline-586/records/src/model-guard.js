/**
 * One model budget and one breaker per space, shared by the routines and the
 * job runner (0.11). The design's budget table (§4.3) already makes
 * `RECORDS_BUDGET_TOKENS` the space's cap "all jobs in a space"; this makes it
 * the routines' cap too, and one ledger each side can see.
 *
 * **The budget** is the space's cap for one day and it counts **all three**
 * ledgers: the routines' `runs`, the jobs' `job_runs`, and what proposing from
 * meeting pages spent. A call that would pass it is refused before the model is
 * reached, so what one side spent leaves the other less instead of each having a
 * private cap.
 *
 * **The breaker** is one state per space: N failed calls in a row open it for
 * the cool-down, and every model call from either side is refused while it is
 * open. It closes by its own clock, with nothing to reset. A call that would
 * pass the day is a **cost stop**, refused as well but never reported as a
 * failing model: it lifts with the next day, not with the cool-down.
 *
 * **A second breaker is the cell's** (design §10.4, scale H5): 50% errors over
 * the last 50 calls open it for the cool-down, whatever the space, and then one
 * call probes it. It sits in front of the per-space breakers, so a provider
 * outage stops every space's calls instead of failing each run in turn, and a
 * space run it refuses is `skipped`, not failed. A 429 and a refused connection
 * count against neither breaker: the provider is not down, it asked to wait.
 *
 * **Only what the provider bills is charged** (scale H5): an answer's own
 * `usage`. The run's own accounting (`routines/llm.js`) charges the prompt of a
 * timeout after sending, and nothing else.
 *
 * The budget's floor is the ledger, and the ledger is written after a call, so
 * the guard is a ceiling, not an accountant: the run's own budget
 * (`routines/llm.js` `openBudget`, the job's `jobDailyTokens`) still decides
 * what one run may ask for.
 *
 * Both are per process, like the routines' lock: safe with the one records
 * process a cell runs today, and the reason a second process would need a
 * shared state (routines/index.js header).
 */
import { BudgetExhausted, LlmError } from "./routines/llm.js"
import { errorText } from "./text.js"
import { dayBounds, localDay, safeTz } from "./routines/dates.js"

const quiet = { debug() {}, info() {}, warn() {}, error() {} }

// Only a fallback: both callers pass their own settings, and the service passes
// the routines' documented 5 (`records/src/config.js`).
export const MODEL_GUARD_DEFAULTS = Object.freeze({ limit: 150_000, breakerFailures: 5, breakerCooldownMs: 3_600_000 })
/** The cell breaker's defaults (design §10.4): 50% of the last 50 calls. */
/**
 * The tiers the cell's breakers are keyed by (plan §4): extraction, and the
 * classifier that guards a person's traits. `extract` is what a caller that names
 * no tier gets, which is the routines' and the jobs' own behaviour.
 */
export const DEFAULT_TIER = "extract"
export const TIERS = Object.freeze(["extract", "classify"])

export const CELL_BREAKER_DEFAULTS = Object.freeze({ window: 50, ratio: 0.5 })

/** The system principal the guard reads a space's ledgers as: never a person. */
const MODEL_GUARD_USER = "routines"

/**
 * @param {{store: any, now?: () => Date, log?: object, config?: {limit?: number, breakerFailures?: number, breakerCooldownMs?: number}}} input
 */
export function createModelGuard({ store, now = () => new Date(), log = quiet, config = {} }) {
  const limit = Number.isFinite(config.limit) ? config.limit : MODEL_GUARD_DEFAULTS.limit
  const breakerFailures = Number.isFinite(config.breakerFailures) ? Math.max(1, config.breakerFailures) : MODEL_GUARD_DEFAULTS.breakerFailures
  const breakerCooldownMs = Number.isFinite(config.breakerCooldownMs) ? config.breakerCooldownMs : MODEL_GUARD_DEFAULTS.breakerCooldownMs
  const cellWindow = Number.isFinite(config.cellWindow) ? Math.max(2, config.cellWindow) : CELL_BREAKER_DEFAULTS.window
  const cellRatio = Number.isFinite(config.cellRatio) ? Math.min(1, Math.max(0.01, config.cellRatio)) : CELL_BREAKER_DEFAULTS.ratio
  /**
   * One entry per space **and tier** (review M4): a classifier's failures are the
   * classifier's, so five of them can never stop that space's extraction.
   */
  const spaces = new Map()
  const entryOf = (spaceId, tier = DEFAULT_TIER) => {
    const key = `${spaceId}\u0000${tier}`
    let entry = spaces.get(key)
    if (!entry) {
      entry = { spaceId, tier, failures: 0, openUntil: 0 }
      spaces.set(key, entry)
    }
    return entry
  }
  /**
   * The cell's breakers, one per process and **per model tier** (design §10.4,
   * plan §4): a tier trips at `cellRatio` errors over its last `cellWindow`
   * calls, probes with one call after the cool-down, and closes when the probe
   * answers. `extract` carries today's defaults; `classify` has its own, so a
   * classifier that is failing stops the classifier and leaves extraction alone.
   */
  const cells = new Map()
  const cellOf = (tier = DEFAULT_TIER) => {
    let cell = cells.get(tier)
    if (!cell) {
      cell = { outcomes: [], openUntil: 0, probing: false }
      cells.set(tier, cell)
    }
    return cell
  }
  const cellOpenUntil = (tier = DEFAULT_TIER) => {
    const cell = cellOf(tier)
    return now().getTime() < cell.openUntil ? cell.openUntil : 0
  }
  const openCell = (tier) => {
    const cell = cellOf(tier)
    cell.openUntil = now().getTime() + breakerCooldownMs
    cell.probing = false
    cell.outcomes = []
    log?.error?.({ event: "memory.model.cell_breaker", tier, until: new Date(cell.openUntil).toISOString(), window: cellWindow, ratio: cellRatio })
  }
  /** One call's outcome for its tier: trips the tier's breaker at the ratio, and closes it on a good probe. */
  function observe(tier, ok) {
    const cell = cellOf(tier)
    if (cell.probing) {
      cell.probing = false
      if (ok) {
        cell.outcomes = []
        cell.openUntil = 0
        return
      }
      openCell(tier)
      return
    }
    cell.outcomes.push(ok)
    if (cell.outcomes.length > cellWindow) cell.outcomes.shift()
    if (cell.outcomes.length >= cellWindow) {
      const errors = cell.outcomes.filter((outcome) => !outcome).length
      if (errors / cell.outcomes.length >= cellRatio) openCell(tier)
    }
  }
  const actorFor = (spaceId) => ({ user: MODEL_GUARD_USER, agent: null, session: null, role: "owner", grants: [], space: spaceId })

  /**
   * What the space has spent in one **local** day, from both ledgers. The day
   * is the space's own (`{day, tz}`, the index page's `fields.tz`): its bounds
   * are the local midnight and the next one, in UTC (`dates.js` `dayBounds`), so
   * an evening run in New York is that day's and never the next UTC day's.
   */
  async function usage(spaceId, when = {}) {
    const tz = safeTz(when.tz)
    const day = when.day ?? localDay(now(), tz)
    const { start, end } = dayBounds(day, tz)
    const space = store.forSpace(spaceId)
    if (typeof space.modelTokens !== "function") return { day, routines: 0, jobs: 0, meetings: 0, used: 0 }
    const spent = await space.modelTokens({ from: start, to: end }, actorFor(spaceId))
    const routines = Number(spent?.routines) || 0
    const jobs = Number(spent?.jobs) || 0
    const meetings = Number(spent?.meetings) || 0
    return { day, routines, jobs, meetings, used: routines + jobs + meetings }
  }

  /** Until when the space's breaker is open, in ms; 0 when it is closed. */
  function openUntil(spaceId, tier = DEFAULT_TIER) {
    const entry = entryOf(spaceId, tier)
    return now().getTime() < entry.openUntil ? entry.openUntil : 0
  }

  /** The message a refused call carries, the same words the routines' breaker used. */
  function breakerError(spaceId, tier = DEFAULT_TIER) {
    return new LlmError(`the model failed ${breakerFailures} times in a row; routines and jobs call it again after ${new Date(openUntil(spaceId, tier)).toISOString()}`, { code: "llm_breaker", tier })
  }

  /**
   * Before a model call: refuse when the space's breaker is open (**the failure
   * stop**), or when a call of about `tokens` would pass the space's day (**the
   * cost stop**). Both mean no call reaches the model; they differ in what
   * ends them — the breaker closes after its cool-down, a spent day at the next
   * day — so neither is reported as the other. Resolves with the day's spend.
   */
  async function check(spaceId, { tokens = 0, day, tz, tier = DEFAULT_TIER } = {}) {
    if (openUntil(spaceId, tier)) throw breakerError(spaceId, tier)
    const cellUntil = cellOpenUntil(tier)
    if (cellUntil) throw new LlmError(`the model failed across the cell; routines call it again after ${new Date(cellUntil).toISOString()}`, { code: "llm_breaker", cell: true })
    // The cool-down has passed while this tier's breaker was open: the one call
    // that comes through now is its probe (design §10.4).
    const cell = cellOf(tier)
    if (cell.openUntil !== 0 && !cell.probing) cell.probing = true
    const spent = await usage(spaceId, { day, tz })
    if (spent.used + Math.max(0, tokens) > limit) throw new BudgetExhausted(spent.used, limit)
    return spent
  }

  /** A call that answered: the failures in a row are over. */
  function ok(spaceId, { tier = DEFAULT_TIER, cellOnly = false } = {}) {
    // A caller whose successes must reach the cell's rate but never clear a
    // space's own count (the engine, review H) says `cellOnly`.
    if (cellOnly) {
      observe(tier, true)
      return
    }
    const entry = entryOf(spaceId, tier)
    entry.failures = 0
    observe(tier, true)
  }

  /**
   * A call that failed: count it, and open the space's breaker at the threshold,
   * and the cell's at its ratio. A 429 or a refused connection says nothing
   * about the provider being down, so it counts against neither breaker and
   * spends nothing (scale H5).
   */
  function fail(spaceId, error, { tier = DEFAULT_TIER, cellOnly = false } = {}) {
    // A rate limit asks to wait: it counts against neither breaker.
    if (error?.status === 429 || error?.code === "llm_rate_limited") return { opened: false, until: 0, counted: false }
    // A refused connection is the network's, not the space's: it never opens the
    // space's breaker, and it does count toward the cell's, because a provider
    // that cannot be reached is exactly what the cell breaker is for (review M1).
    if (error?.code === "llm_unreachable") {
      observe(tier, false)
      return { opened: false, until: 0, counted: false }
    }
    // The cell learns of every real failure; a caller that must not move its
    // own space's count (the engine, whose failures may never stop a live
    // daily, S3b's H1) says `cellOnly` and only the cell is counted.
    observe(tier, false)
    if (cellOnly) return { opened: false, until: cellOpenUntil(tier), counted: false, cell: true }
    const entry = entryOf(spaceId, tier)
    entry.failures += 1
    if (entry.failures < breakerFailures) return { opened: false, until: 0, counted: true }
    entry.openUntil = now().getTime() + breakerCooldownMs
    entry.failures = 0
    const until = new Date(entry.openUntil).toISOString()
    // Ids only: the space, the instant, and the failure's own words (which name
    // the model's answer, never a space's text).
    log?.error?.({ event: "memory.model.breaker", team: spaceId, until, error: errorText(String(error?.message ?? error), 200) })
    return { opened: true, until: entry.openUntil, counted: true }
  }

  /**
   * One model call, guarded: the breaker and the budget are checked, the call
   * runs, and its answer or failure moves the breaker. `complete` is the only
   * door both sides use, so neither can spend without the other knowing.
   */
  async function complete(spaceId, call, { tokens, day, tz, tier = DEFAULT_TIER } = {}) {
    await check(spaceId, { tokens, day, tz, tier })
    let answer
    try {
      answer = await call()
    } catch (error) {
      fail(spaceId, error, { tier })
      throw error
    }
    ok(spaceId, { tier })
    return answer
  }

  /** What the console and `routines.status` show: the breakers and the local day's spend. */
  async function state(spaceId, when = {}) {
    const spent = await usage(spaceId, when)
    const until = openUntil(spaceId)
    const cellUntil = cellOpenUntil()
    return {
      limit,
      breaker: until ? new Date(until).toISOString() : null,
      opened_at: until ? new Date(until - breakerCooldownMs).toISOString() : null,
      cell_breaker: cellOpenUntil(when?.tier ?? DEFAULT_TIER) ? new Date(cellOpenUntil(when?.tier ?? DEFAULT_TIER)).toISOString() : null,
      tiers: Object.fromEntries([...new Set([DEFAULT_TIER, ...cells.keys()])].map((tier) => [tier, cellOpenUntil(tier) ? new Date(cellOpenUntil(tier)).toISOString() : "closed"])),
      failures: entryOf(spaceId, when?.tier ?? DEFAULT_TIER).failures,
      budget: spent,
    }
  }

  /** When each tier's cell breaker opened, and when it closes: what a page reads. */
  function cellState(tier = DEFAULT_TIER) {
    const until = cellOpenUntil(tier)
    return { tier, until: until ? new Date(until).toISOString() : null, opened_at: until ? new Date(until - breakerCooldownMs).toISOString() : null }
  }
  return { limit, breakerFailures, breakerCooldownMs, cellWindow, cellRatio, usage, openUntil, cellOpenUntil, cellState, check, ok, fail, complete, state, tiers: () => [...cells.keys()] }
}
