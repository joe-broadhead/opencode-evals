/**
 * The tiers (design §10.4, plan §4): the cell's breakers per tier, a tier's
 * `not_before` for a 429, and the version pause.
 *
 * **A 429 is not a failure and not a sleep.** The provider names how long to
 * wait (`Retry-After`); the engine's client is asked not to sleep inside the
 * call (`{rateLimitRetry: false}`) and the tier's `not_before` carries the wait
 * instead, so no worker is held asleep and nothing is charged.
 *
 * **A version pause** is the model's own fault, not the provider's: more than 5%
 * bad answers or length stops over the last 200 calls of one extractor digest
 * pause that digest for the cell, and the log says `memory.engine.version_paused`.
 */
/**
 * Network causes that mean the provider, not us (review H): a refused or reset
 * connection, a name that does not resolve, a connection that timed out, and the
 * undici codes. An error with no status and **no** known cause is the engine's
 * own fault, and must never touch the shared breaker.
 */
export const NETWORK_CODES = Object.freeze(["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH"])

const codeOf = (error) => String(error?.cause?.code ?? error?.code ?? "")
const isNetwork = (error) => NETWORK_CODES.includes(codeOf(error)) || codeOf(error).startsWith("UND_ERR_")

/**
 * What one failed call was (review H and M). Every outcome is named, because a
 * catch-all is how an engine bug came to look like an outage:
 *
 * - `provider`: a 5xx, the call's own timeout, or a network cause (the client's
 *   own `llm_unreachable` is one). It counts against the shared tier, because an
 *   outage is one fact.
 * - `auth`: a 401 or 403 — the key or the configuration is wrong for everyone.
 *   Neutral for the shared breaker, and the engine pauses itself.
 * - `item`: a 400 or 422 — the item's own fault. Neutral for the breaker, and it
 *   spends the item's attempt.
 * - `fault`: anything else, a `TypeError` included. The engine's own bug: never
 *   the shared breaker's, and the engine pauses itself.
 */
export function classifyFailure(error) {
  const status = Number(error?.status) || 0
  if (status === 401 || status === 403) return "auth"
  // A 200 whose body is not JSON is the model's quality, not the engine's: it is
  // an item failure, and the version pause is what watches the rate of them
  // (review M2).
  if (String(error?.code ?? "") === "llm_bad_answer") return "item"
  if (status >= 400 && status < 500) return "item"
  if (status >= 500) return "provider"
  if (["llm_timeout", "llm_unreachable"].includes(String(error?.code ?? "")) || /timeout/i.test(String(error?.name ?? ""))) return "provider"
  if (isNetwork(error)) return "provider"
  return "fault"
}

export const BAD_RATIO = 0.05
export const BAD_WINDOW = 200
/** A version pause's first cool-down, the most it may grow to, and its probe batch. */
export const VERSION_COOL_MS = 5 * 60_000
export const VERSION_MAX_MS = 60 * 60_000
export const VERSION_PROBE_ITEMS = 20

/**
 * @param {{now?: () => number, log?: any, guard?: any, window?: number, ratio?: number}} [options]
 */
export function createTiers({ now = () => Date.now(), log = null, guard = null, window = BAD_WINDOW, ratio = BAD_RATIO } = {}) {
  /** tier → the ms until which the provider asked the tier to wait. */
  const waits = new Map()
  /** digest → the outcomes of its last `window` calls, `true` for a good answer. */
  const digests = new Map()
  const paused = new Map()
  const state = { paused: 0 }
  // The service's log is `jsonLog` (with `.error`); a test's is a function.
  const say = (line) => {
    if (typeof log === "function") log(line)
    else log?.error?.(line)
  }

  const outcomesOf = (digest) => {
    let list = digests.get(digest)
    if (!list) {
      list = []
      digests.set(digest, list)
    }
    return list
  }

  return {
    /** The ms until which this tier is delayed by a 429; 0 when it is free. */
    notBefore(tier = "extract") {
      const until = waits.get(tier) ?? 0
      return until > now() ? until : 0
    },
    /** The provider asked this tier to wait `ms`. */
    delay(tier, ms) {
      const waited = Math.max(0, Number(ms) || 0)
      if (waited === 0) return 0
      const until = now() + waited
      waits.set(tier, Math.max(waits.get(tier) ?? 0, until))
      return until
    },
    /** True when a digest is paused for the cell. */
    isPaused(digest) {
      return paused.has(String(digest ?? ""))
    },
    pausedDigests() {
      return [...paused.keys()]
    },
    /**
     * A paused digest, as an operator reads it: since when, its bad-answer rate
     * and its next probe. `null` when it is not paused.
     */
    pauseOf(digest) {
      const entry = paused.get(String(digest ?? ""))
      if (!entry) return null
      return { digest: String(digest ?? ""), since: new Date(entry.at).toISOString(), bad: entry.bad, window: entry.window, rate: entry.bad / Math.max(1, entry.window), next_probe: new Date(entry.until).toISOString(), cool_ms: entry.cool }
    },
    /** True when the pause's cool-down has passed and the next batch is its probe. */
    probeDue(digest) {
      const entry = paused.get(String(digest ?? ""))
      return Boolean(entry && now() >= entry.until)
    },
    /**
     * The probe batch's answer: at most one bad answer resumes the digest and
     * resets the wait; more re-pauses it with the next wait in the sequence.
     */
    settleProbe(digest, { bad = 0 } = {}) {
      const key = String(digest ?? "")
      const entry = paused.get(key)
      if (!entry) return { resumed: true }
      if (bad <= 1) {
        paused.delete(key)
        digests.delete(key)
        state.paused = Math.max(0, state.paused - 1)
        return { resumed: true }
      }
      entry.cool = Math.min(VERSION_MAX_MS, entry.cool * 2)
      entry.until = now() + entry.cool
      entry.at = now()
      entry.bad = bad
      entry.window = Math.max(1, bad)
      return { resumed: false, next_probe: new Date(entry.until).toISOString() }
    },
    /**
     * One call's outcome for a digest: `bad` is a bad answer or a length stop.
     * The digest pauses once its window is full and more than `ratio` of it is
     * bad.
     */
    recordAnswer(digest, { bad = false } = {}) {
      const key = String(digest ?? "")
      const list = outcomesOf(key)
      list.push(!bad)
      if (list.length > window) list.shift()
      if (list.length >= window && !paused.has(key)) {
        const badCount = list.filter((good) => !good).length
        if (badCount / list.length > ratio) {
          paused.set(key, { at: now(), bad: badCount, window: list.length, cool: VERSION_COOL_MS, until: now() + VERSION_COOL_MS, probing: false })
          state.paused += 1
          say({ event: "memory.engine.version_paused", digest: key, window: list.length, bad: badCount, ratio })
        }
      }
      return { paused: paused.has(key) }
    },
    /** The §10.5 counters this module keeps. */
    state() {
      return { ...state, paused_digests: [...paused.keys()], version: [...paused.keys()].map((key) => this.pauseOf(key)), waits: Object.fromEntries([...waits.entries()].map(([tier, until]) => [tier, until > now() ? until - now() : 0])) }
    },
    /** The guard, for the metrics that read it. */
    guard,
  }
}
