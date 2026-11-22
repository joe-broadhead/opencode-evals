/**
 * How far back Memory reads when a source is first collected (lane 0195).
 *
 * A source starts collecting at the bind, so the person's earlier items never
 * arrived. **The window is Memory's policy, by source, in one table here**; the
 * plugin's contract and the plugins do not change (`events_list` already takes
 * `since`). Records stores the anchor, the collector sends it, and the console
 * names the window in the consent and lets the person choose 0 or another number.
 *
 * The table is clamped to 30 days: events are kept 30 days from ingestion
 * (`RECORDS_EVENT_RETENTION_DAYS`), so an older window would expire unread.
 * A source is read by the id it declares; a legacy alias reads as the declared
 * source it stands for (`legacy-sources.js`), and a source the table does not
 * name reads nothing extra, because a window is new data acquisition and the
 * person did not agree to one for a source Memory has no policy for.
 */
import { invalid } from "../errors.js"
import { LEGACY_SOURCES } from "./legacy-sources.js"

/** The most any window is: retention would expire the rest unread. */
export const HISTORY_MAX_DAYS = 30

/**
 * Days by declared source id, or by `<plugin>.*` for every source of a plugin.
 * An exact id wins over its plugin's.
 *
 * - meetings, recordings, interviews: a month of context for the daily routine;
 * - sessions: the person's own machine, no cost;
 * - issues: busy feeds, so two weeks;
 * - mail and chat: the highest volume, so one week (gmail fails on very wide windows);
 * - `x.*`: each read is billed, so none unless the person chooses;
 * - calendar: it already reads forward from Google's own window, so nothing extra.
 */
export const HISTORY_WINDOWS = Object.freeze({
  "granola.meetings": 30,
  "plaud.recordings": 30,
  "wisprflow.meetings": 30,
  "affinity.*": 30,
  "ashby.*": 30,
  "metaview.*": 30,
  "history.sessions": 30,
  "boxd.*": 30,
  "jobs.*": 30,
  "linear.*": 14,
  "jira.*": 14,
  "github.*": 14,
  "notion.*": 14,
  "gws.gmail": 7,
  "slack.*": 7,
  "x.*": 0,
  "gws.calendar": 0,
  "gws.calendar.today": 0,
})

/** The declared source id a name stands for: itself, or the source its legacy alias was mapped to. */
function declaredIdOf(source) {
  const name = String(source ?? "")
  return LEGACY_SOURCES[name]?.declared?.[0] ?? name
}

/**
 * The days Memory reads before the bind by default, for a source (0 to 30).
 *
 * @param {string} source a declared id or a legacy alias
 * @returns {number}
 */
export function historyWindowDays(source) {
  const id = declaredIdOf(source)
  const exact = HISTORY_WINDOWS[id]
  const days = exact ?? HISTORY_WINDOWS[`${id.split(".")[0]}.*`] ?? 0
  return Math.max(0, Math.min(HISTORY_MAX_DAYS, days))
}

/**
 * The person's choice of days from a dialog that **named** the window: 0 (no
 * history), or a whole number up to 30. More than 30 is 30; a value that is not
 * a whole number of days is refused.
 *
 * **No choice is 0, never the source's default.** A window is read only when the
 * person chose it in a dialog that named it: the console always sends the number
 * it showed, so a records that deploys before the gateway is never asked to read
 * 30 days of somebody's mail and meetings under a dialog that said nothing.
 *
 * **X is 0 whatever arrives**: each of its reads is billed, and a window nobody
 * named is not a window to pay for.
 *
 * @param {unknown} value what the person sent: nothing, a number, or the text a form sends
 * @param {string} source
 * @returns {number}
 */
export function chosenHistoryDays(value, source) {
  if (value === undefined || value === null) return 0
  const refuse = () => invalid("invalid_lookback", "lookback_days must be a whole number of days from 0 to 30.", "Send 0 for no history, or a number of days up to 30.")
  const days = typeof value === "number" ? value : typeof value === "string" && /^\d{1,4}$/.test(value.trim()) ? Number(value) : Number.NaN
  if (!Number.isInteger(days) || days < 0) throw refuse()
  if (billedReads(source)) return 0
  return Math.min(HISTORY_MAX_DAYS, days)
}

/** True for a source whose every read is billed (`x.*`, and the legacy `x`): memory never buys a window for it unasked. */
export function billedReads(source) {
  return declaredIdOf(source).startsWith("x.")
}

/** The anchor: `days` before `at`, as an ISO time, or null for no history. */
export function historyAnchor(at, days) {
  if (!Number.isInteger(days) || days <= 0) return null
  return new Date(Date.parse(at) - days * 86_400_000).toISOString()
}

/**
 * What a request row says about its window, for the consent to name: the default
 * days, and the most a person may choose (**0 for a billed source: no choice**,
 * since records clamps X to 0 whatever arrives).
 */
export function requestHistory(source) {
  return { window_days: historyWindowDays(source), max_days: billedReads(source) ? 0 : HISTORY_MAX_DAYS }
}
