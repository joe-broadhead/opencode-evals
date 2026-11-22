/**
 * The lanes (design §10.1, S3a): Memory assigns every collected event a lane at
 * ingest, from its own checks, so a scheduler has one order per space instead of
 * one row per routine per event.
 *
 * - **`backfill`** is consent's own window: an item whose `occurred_at` is
 *   earlier than its binding's confirmation less 24 hours, or older than the
 *   cutover watermark (the moment the engine was first switched on in the
 *   space). It is checked first, so an old message of the person's own is still
 *   history: the bind's window is about how far back a source is read, not about
 *   who wrote each item.
 * - **`own`** is a message the person wrote or one addressed to them, and it uses
 *   the one self rule the routines already have: S1's `isSelfActor`, over the
 *   binding's own owner id and the identities the person confirmed in the
 *   console. A plugin's `self: true` never upgrades a stranger, and only its
 *   `self: false` can take the person's word away.
 * - **`general`** is everything else.
 *
 * A shared space gets no lane at all (§8.4): `openLane` refuses one, so no unit
 * of a team space is ever leased.
 */
import { isSelfActor } from "../routines/passes.js"
import { EngineError, personalSpaceOnly } from "./errors.js"

/** The lanes, in the order the scheduler reads them. */
export const LANES = Object.freeze(["own", "general", "backfill"])

/** The 24 hours before a binding's confirmation that are still the person's present. */
export const BACKFILL_WINDOW_MS = 24 * 60 * 60 * 1000

/** The actor roles that attribute an item to its writer. */
const WROTE = new Set(["from", "author", "sender", "speaker"])
/** The actor roles that address an item to someone. */
const ADDRESSED = new Set(["to", "cc"])

/**
 * The lane rule's own constant work, hoisted out of the per-event loop: the
 * binding's 24-hour window opens once per page, not once per event.
 *
 * @param {{binding?: object|null, person?: object|null, watermark?: string|null}} [input]
 */
export function laneContext({ binding = null, person = null, watermark = null } = {}) {
  const msOf = (value) => {
    const ms = value ? Date.parse(String(value)) : Number.NaN
    return Number.isFinite(ms) ? ms : Number.NaN
  }
  return { binding, person, confirmedMs: msOf(binding?.confirmed_at), cutoverMs: msOf(watermark) }
}

/**
 * The lane one event belongs to.
 *
 * @param {object} event a normalised event (`actors`, `occurred_at`)
 * @param {{binding?: object|null, person?: object|null, watermark?: string|null, confirmedMs?: number, cutoverMs?: number}} [context]
 *   `laneContext`'s answer, or the three inputs it builds one from
 * @returns {"own" | "general" | "backfill"}
 */
export function laneOf(event, context = {}) {
  const { binding = null, person = null } = context
  let { confirmedMs, cutoverMs } = context
  if (confirmedMs === undefined || cutoverMs === undefined) {
    const built = laneContext(context)
    if (confirmedMs === undefined) confirmedMs = built.confirmedMs
    if (cutoverMs === undefined) cutoverMs = built.cutoverMs
  }
  const occurred = Date.parse(String(event?.occurred_at ?? ""))
  if (!Number.isFinite(occurred)) return "general"
  if (Number.isFinite(confirmedMs) && occurred < confirmedMs - BACKFILL_WINDOW_MS) return "backfill"
  if (Number.isFinite(cutoverMs) && occurred < cutoverMs) return "backfill"
  if (!binding || !person) return "general"
  const about = { source: binding.source, account: binding.account }
  const actors = Array.isArray(event?.actors) ? event.actors : []
  const mine = actors.some((actor) => {
    const role = String(actor?.role ?? "").toLowerCase()
    if (!WROTE.has(role) && !ADDRESSED.has(role)) return false
    return Boolean(actor?.id) && isSelfActor(person, actor.id, about, actor.self)
  })
  return mine ? "own" : "general"
}

/**
 * Open one lane in one space (§8.4): a personal space only. S3b's scheduler
 * calls this before a lane's first lease; in S3a it is the rule's own seam, and
 * the answer names the space and the lane it opened.
 *
 * @param {{space: {spaceId: string, spaceKind?: string}, lane: string, source: string, seq?: number}} input
 * @returns {Promise<{space: string, lane: string, source: string, seq: number}>}
 */
export async function openLane({ space, lane = "own", source = "", seq = 0 } = {}) {
  const spaceId = typeof space?.spaceId === "string" ? space.spaceId : ""
  if (!LANES.includes(lane)) {
    throw new EngineError("invalid_lane", `"${lane}" is not a lane.`, `Send a lane as ${LANES.join(", ")}.`, { status: 400 })
  }
  // A space that does not say it is personal is not opened: the safe default is
  // the design's own — personal spaces only.
  if (space?.spaceKind !== "personal") throw personalSpaceOnly(spaceId || "this one")
  return { space: spaceId, lane, source: String(source ?? ""), seq: Number(seq) || 0 }
}
