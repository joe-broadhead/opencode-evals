/**
 * The id a binding names: a built-in source's name, or a plugin-declared source's
 * contract id (source-contract's `SOURCE_ID`) — `gws.gmail`, `gws.calendar.today`,
 * lowercase, dotted, at most 64 characters.
 *
 * One copy, four users: the plugin (`src/collector.js`, `src/tools/spaces.js`), the
 * records service, and the console. The package does not export its `SOURCE_ID`, so
 * `test/source-ids.test.js` holds every copy to the contract's own `checkSources`.
 */
export const BUILTIN_SOURCE_NAME = /^[a-z][a-z0-9_-]{0,31}$/
/** The contract's `SOURCE_ID`: `[a-z][a-z0-9-]*(.[a-z][a-z0-9-]*)+`. */
export const CONTRACT_SOURCE_ID = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/
/** The contract's cap on a source id, in characters. */
export const SOURCE_ID_MAX = 64

/**
 * True for a binding's source: a built-in name (Memory's own word rule), or a
 * declared source's contract id at the contract's length.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isSourceName(value) {
  return typeof value === "string" && (BUILTIN_SOURCE_NAME.test(value) || (value.length <= SOURCE_ID_MAX && CONTRACT_SOURCE_ID.test(value)))
}
