/**
 * The routines design, §10.5 and scale M5: the ready index.
 *
 * A space with work says so in one small file beside its own, `spaces/<id>.ready`,
 * holding `{deadline, pending_tokens, lanes}`. The scheduler (S3b) works from
 * those files alone and never lists or opens the space files, so a cell with
 * 10,000 cold spaces pays for the ones with work.
 *
 * It is **not** `.work`: `drainOnce` lists `spaces/*.work` and would run removal
 * slices on anything with that suffix. The marker is written when a space goes
 * from idle to busy, or when its earliest deadline moves earlier — never on
 * every ingest — and the index is rebuilt from the markers alone.
 */
import fs from "node:fs"
import path from "node:path"

/** The suffix the ready markers carry. Never `.work` (§2). */
export const READY_SUFFIX = ".ready"

/** The marker's own path in a spaces directory. */
export function readyPath(spacesDir, spaceId) {
  return path.join(spacesDir, `${spaceId}${READY_SUFFIX}`)
}

/** A marker's state, or null when there is none or it cannot be read. */
export function readReady(spacesDir, spaceId) {
  try {
    const raw = fs.readFileSync(readyPath(spacesDir, spaceId), "utf8")
    const state = JSON.parse(raw)
    return state && typeof state === "object" ? state : null
  } catch {
    // Missing is idle; a half-written marker is idle too, and the next ingest
    // writes a whole one.
    return null
  }
}

const deadlineOf = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null)

/**
 * What this process last wrote per space, so an ingest page pays a memory read
 * rather than a file read on the busy path. The records service runs one process
 * per cell's set of space files (`routines/index.js`), and `clear` forgets an
 * entry, so the cache cannot outlive the marker it stands for.
 */
const lastWritten = new Map()

const cacheKey = (spacesDir, spaceId) => `${spacesDir}\u0000${spaceId}`

/**
 * Say the space has work, if that is news: idle to busy, or an earlier earliest
 * deadline. The state is `{deadline, pending_tokens, lanes}`.
 *
 * @param {string} spacesDir the store's `spaces/` directory
 * @param {string} spaceId
 * @param {{deadline?: number|null, pendingTokens?: number|null, lanes?: string[]}} state
 * @returns {{written: boolean, state: object}}
 */
export function touchReady(spacesDir, spaceId, { deadline = null, pendingTokens = null, lanes = [] } = {}) {
  const next = {
    deadline: deadlineOf(deadline),
    pending_tokens: typeof pendingTokens === "number" && Number.isFinite(pendingTokens) ? pendingTokens : null,
    lanes: Array.isArray(lanes) ? [...new Set(lanes.map(String))].sort() : [],
  }
  const key = cacheKey(spacesDir, spaceId)
  const current = lastWritten.has(key) ? lastWritten.get(key) : readReady(spacesDir, spaceId)
  const earlier = next.deadline !== null && (deadlineOf(current?.deadline) === null || next.deadline < current.deadline)
  if (current !== null && !earlier) {
    lastWritten.set(key, current)
    return { written: false, state: current }
  }
  try {
    fs.mkdirSync(spacesDir, { recursive: true })
    fs.writeFileSync(readyPath(spacesDir, spaceId), JSON.stringify(next))
    lastWritten.set(key, next)
    return { written: true, state: next }
  } catch {
    // A marker that cannot be written only delays the work to the next ingest,
    // and the space's own cursor still holds what is unread.
    lastWritten.delete(key)
    return { written: false, state: current ?? next }
  }
}

/** The space has no work left (S3b calls this when a lane drains). */
export function clearReady(spacesDir, spaceId) {
  lastWritten.delete(cacheKey(spacesDir, spaceId))
  try {
    fs.rmSync(readyPath(spacesDir, spaceId), { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Every space with work, from the markers alone: `[{space, deadline,
 * pending_tokens, lanes}]`, earliest deadline first and an unknown deadline
 * last. No space file is listed or opened.
 */
export function readyIndex(spacesDir) {
  let names = []
  try {
    names = fs.readdirSync(spacesDir).filter((name) => name.endsWith(READY_SUFFIX))
  } catch {
    return []
  }
  const entries = []
  for (const name of names) {
    const space = name.slice(0, -READY_SUFFIX.length)
    if (!space) continue
    const state = readReady(spacesDir, space)
    if (state === null) continue
    entries.push({ space, deadline: deadlineOf(state.deadline), pending_tokens: typeof state.pending_tokens === "number" ? state.pending_tokens : null, lanes: Array.isArray(state.lanes) ? state.lanes : [] })
  }
  return entries.sort((a, b) => {
    if (a.deadline === null && b.deadline === null) return a.space < b.space ? -1 : 1
    if (a.deadline === null) return 1
    if (b.deadline === null) return -1
    return a.deadline - b.deadline || (a.space < b.space ? -1 : 1)
  })
}
