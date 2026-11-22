/**
 * The history anchor on a binding, and the one-time import (lane 0195).
 *
 * `sources.first_since` is the earliest time Memory asks a source for. It is
 * returned by `events.cursor` **only while no cursor is saved**, so a collector
 * that wakes late reads the same window, and a resumed read is by its cursor
 * alone. Two things set it:
 *
 * - **the bind** (`anchorBinding`): the confirmation time less the window the
 *   person chose, at most 30 days (`history-window.js`);
 * - **an import** (`importHistory`): for a binding that was made before it
 *   existed, or made with 0 days. One transaction sets the anchor and clears the
 *   saved cursor; the next collection reads from `since`, and the events it
 *   brings again are dropped by id and hash (`events.ingest`), while an item the
 *   person forgot stays refused by its tombstone.
 *
 * **`confirmed_at` is never written here.** The engine routes an event to its
 * `backfill` lane by it (`engine/lanes.js`), and `ingest` mode is live: an import
 * must not move what every earlier event was routed by.
 *
 * The columns are additive and nullable (`schema.js` `COLUMN_SPECS`), and 0.15.10
 * never reads them, so a rollback opens the file and the binding collects as before.
 */
import { conflict, invalid, notFound } from "../errors.js"
import { HISTORY_MAX_DAYS, billedReads, historyAnchor, historyWindowDays } from "./history-window.js"

/**
 * Anchor a binding at its bind. Only a binding that has no cursor and has not
 * been imported is touched: a re-confirm of a source that is collecting must not
 * make it read a window again.
 *
 * @param {{ get: Function, run: Function }} handle inside the binding's transaction
 * @param {{ source: string, account: string, nowIso: string, days: number }} input
 */
export function anchorBinding(handle, { source, account, nowIso, days }) {
  const row = handle.get("select cursor, history_via from sources where source = ? and account = ?", source, account)
  if (!row || row.cursor || row.history_via === "import") return
  handle.run("update sources set first_since = ?, history_days = ?, history_via = 'bind' where source = ? and account = ?", historyAnchor(nowIso, days), days, source, account)
}

/**
 * The history facts of a binding, as `sources.list` answers them: what the
 * policy gives it, what it has, and whether the anchor is still waiting to be read.
 *
 * **Read means the collector reported that it sent that `since`.** A saved
 * cursor is not evidence: a collector older than this release sends no `since`,
 * reads the plugin's own 24-hour window and saves a cursor, and the anchor must
 * stay pending — and the import offered — rather than count as read.
 *
 * @param {object} row the `sources` row
 * @param {object|null} collection its `source_collections` row, which holds the last `since` a report named
 */
export function historyOf(row, collection = null) {
  const since = typeof row.first_since === "string" && row.first_since ? row.first_since : null
  const sent = typeof collection?.since_sent === "string" && collection.since_sent ? collection.since_sent : null
  // A narrowed window is a later start, so a report at or after the anchor read (part of) it.
  const read = Boolean(since && sent && Number.isFinite(Date.parse(sent)) && Date.parse(sent) >= Date.parse(since))
  return {
    window_days: historyWindowDays(row.source),
    max_days: HISTORY_MAX_DAYS,
    days: Number.isInteger(row.history_days) ? row.history_days : null,
    via: row.history_via === "bind" || row.history_via === "import" ? row.history_via : null,
    since,
    read,
    pending: since !== null && !read,
  }
}

/** `days` for an import: a whole number from 1; more than 30 is 30. Unlike a bind, an import always names its number. */
function importDays(value, source) {
  const days = typeof value === "number" ? value : typeof value === "string" && /^\d{1,4}$/.test(value.trim()) ? Number(value) : Number.NaN
  if (!Number.isInteger(days) || days < 1) {
    throw invalid("invalid_lookback", "days must be a whole number of days from 1 to 30.", "Send the number of past days to import, up to 30.")
  }
  if (billedReads(source)) return 0
  return Math.min(HISTORY_MAX_DAYS, days)
}

/**
 * sources.import: read the last N days of a binding that was made before history
 * import existed, once. The caller (the store) has checked the role, the
 * person's own personal space and the browser session; this is the rule.
 *
 * @param {{ handle: { get: Function, run: Function }, nowIso: string }} ctx inside a transaction
 * @param {{ source: string, account: string }} key
 * @param {unknown} daysInput
 */
export function importHistory({ handle, nowIso }, { source, account }, daysInput) {
  const days = importDays(daysInput, source)
  const row = handle.get("select * from sources where source = ? and account = ?", source, account)
  if (!row) throw notFound(`${source} (${account}) is not bound to this space.`, "Import only a source Sources lists as collecting.")
  if (row.status !== "confirmed" || !row.enabled) {
    throw conflict("source_off", `${source} (${account}) is not collecting, so there is nothing to import into.`, "Turn the source on and confirm its account in Memory's console, Sources, then import.")
  }
  // A source Memory buys no window for (X: each read is billed) has no history to import.
  if (days === 0) throw conflict("no_history_window", `${source} (${account}) has no history window: ${billedReads(source) ? "each of its reads is billed, so Memory reads it from the bind" : "Memory gives it none"}.`, "Nothing was changed. Collection continues as it is.")
  const history = historyOf(row, handle.get("select * from source_collections where source = ? and account = ?", source, account))
  // Once per binding, and only once a collection reported reading the window. A saved cursor is not that report: an older
  // collector saves one from the plugin's own 24 hours while naming no `since`, and the import must stay available.
  if (history.read) throw conflict("import_done", `${source} (${account}) has already had its history read, once.`, "A binding imports its history once. Collection continues from where it is.")
  // An anchor that no collection reported reading is re-armed: the person's new window replaces it and the cursor is cleared.
  const since = historyAnchor(nowIso, days)
  // One statement: the anchor and the cleared cursor change together, and `confirmed_at` is not in it.
  handle.run("update sources set first_since = ?, history_days = ?, history_via = 'import', cursor = null, cursor_at = null, updated = ? where source = ? and account = ?", since, days, nowIso, source, account)
  return { import: { source, account, days, since, via: "import" } }
}
