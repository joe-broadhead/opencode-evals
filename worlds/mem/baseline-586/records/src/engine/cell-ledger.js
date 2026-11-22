/**
 * The cell's engine ledger (plan §4, decision 4): what the cohort spent in one
 * UTC day, at `dataDir/engine/spend-<day>.json`, written once a minute and read
 * at start-up.
 *
 * It exists so the service cap can see the engine **without opening every space
 * file**: the service's own seeding calls `runTokens` on every space each day,
 * which the daily keeps until S8, and the engine's half is one small file. The
 * fair-share cap is `min(configured, service × weight ÷ active)`, where *active*
 * comes from the ready index and every space has weight 1 until S5.
 */
import fs from "node:fs"
import path from "node:path"

export const SAVE_EVERY_MS = 60_000
export const DEFAULT_WEIGHT = 1

/**
 * @param {{dataDir: string, now?: () => Date, saveEveryMs?: number, fs?: any, path?: any}} input
 */
export function createCellLedger({ dataDir, now = () => new Date(), saveEveryMs = SAVE_EVERY_MS, fs: fsImpl = fs, path: pathImpl = path } = {}) {
  const dir = path.join(dataDir, "engine")
  const state = { day: null, tokens: 0, saved: 0, loaded: 0, calls: 0 }
  const fileFor = (day) => path.join(dir, `spend-${day}.json`)

  /** Read the day's file, once per process, so a restart does not start the day again. */
  function load(day = now().toISOString().slice(0, 10)) {
    if (state.day === day) return state.tokens
    state.day = day
    state.tokens = 0
    try {
      const parsed = JSON.parse(fs.readFileSync(fileFor(day), "utf8"))
      state.tokens = Number(parsed?.tokens) || 0
      state.loaded += 1
    } catch {
      // A missing or half-written file is a day that has spent nothing yet.
    }
    return state.tokens
  }

  function save({ force = false } = {}) {
    const at = now().getTime()
    if (!force && at - state.saved < saveEveryMs) return false
    try {
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(fileFor(state.day ?? now().toISOString().slice(0, 10)), JSON.stringify({ day: state.day, tokens: state.tokens, saved: now().toISOString() }))
      state.saved = at
      return true
    } catch {
      // A ledger that cannot be written only loses a restart's memory of the
      // day; the spaces' own ledgers still hold every line.
      return false
    }
  }

  return {
    /** The day's spend so far, read from the file on the first ask. */
    spent(day) {
      return load(day)
    },
    /** Add a call's billed tokens to the day. */
    add(tokens, { save: saveNow = false } = {}) {
      load()
      state.tokens += Number(tokens) || 0
      state.calls += 1
      if (saveNow) save({ force: true })
      else save()
      return state.tokens
    },
    save,
    state() {
      return { day: state.day, tokens: state.tokens, loaded: state.loaded, calls: state.calls }
    },
  }
}

/**
 * The fair-share cap (plan §4, decision 7): `min(configured, service × weight ÷
 * active)`, with every space's weight 1 until S5. `active` is the number of
 * spaces the ready index names, so an idle cell divides by no more than it has.
 *
 * @param {{configured: number, service: number, weight?: number, active: number}} input
 */
export function fairShareCap({ configured, service, weight = DEFAULT_WEIGHT, active = 1 } = {}) {
  const spaces = Math.max(1, Number(active) || 1)
  const share = (Math.max(0, Number(service) || 0) * Math.max(0, Number(weight) || DEFAULT_WEIGHT)) / spaces
  return Math.max(0, Math.min(Number(configured) || 0, share))
}
