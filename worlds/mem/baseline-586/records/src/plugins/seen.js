/**
 * When a plugin was last listed (lane 0188, round 2; POLLING §3.1 and §5).
 *
 * A `plugins.report` is one machine's or one agent process's discovery. It
 * carries no id that tells the machines apart, so the service does not try: a
 * report adds or refreshes the plugins it lists (`plugins.listed_at`) and says
 * nothing about the others. A person's second machine, or a second agent
 * process with different tools, can no longer mark the first one's plugins
 * missing.
 *
 * A plugin is **missing** only when no report has listed it for
 * PLUGIN_MISSING_AFTER_MS. That is the one place this age is read: "is it on
 * offer to turn on", and what the Sources page shows. Every safety check (the
 * consent a declared source needs, the retired legacy aliases, a changed
 * package) reads the stored declaration at any age, so a plugin that is quiet
 * is still guarded, and nothing becomes allowed because a report stopped.
 */

/**
 * 7 days. Every OpenCode process with Memory reports every 30 minutes, so a
 * week of silence from all of them means nothing runs the plugin. It is long
 * enough to cover a laptop that is shut over a long weekend or a holiday week,
 * so a source stays possible to turn on, and short enough that a removed plugin
 * leaves the Sources page within a week.
 */
export const PLUGIN_MISSING_AFTER_MS = 7 * 24 * 3_600_000

/** What the service says of a plugin it has not seen listed for that long. */
export const PLUGIN_MISSING = "not installed on any machine that has reported lately"

/** The state a plugin row is offered with: its stored state, or `missing` when no report has listed it lately. */
export function listedState(row, nowMs) {
  if (row.state === "missing") return "missing"
  const listed = Date.parse(row.listed_at ?? "")
  // A row with no listing time is one this build has not seen listed: it keeps its stored state.
  if (!Number.isFinite(listed)) return row.state
  return nowMs - listed > PLUGIN_MISSING_AFTER_MS ? "missing" : row.state
}
