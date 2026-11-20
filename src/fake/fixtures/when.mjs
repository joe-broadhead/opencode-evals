// Dates in a fake's queries, shared by the fixtures (the fake's whole `fixtures/` directory is copied into the trial). A date alone (`2026-09-05`,
// `2026/09/05`) is a day, a date with a time (`2026-09-05 10:30`, `2026-09-05T10:30:00Z`) is an instant, and `-7d`, `-2w`, `-12h` and `now()` are
// instants counted from NOW, which is fixed: a fake that read the clock would answer differently every day. UTC throughout. Relative forms are Jira's:
// `-7d`, `+2w`, `-12h`, `-30m`, `-1M`, `-1y`, and the functions `startOfDay()`, `startOfWeek()` (Monday), `startOfMonth()`, `startOfYear()` and their `endOf` twins, each
// with an optional increment that is applied to now first (`startOfWeek(-1w)`, `startOfMonth(-1M)`; a bare `-1` counts in the function's own unit).
// The fixtures decide what a comparison means (Jira reads a bare date as that day's midnight, GitHub compares whole days).

/** The fake's "now": the day after the newest thing in either fixture. */
export const NOW = Date.UTC(2026, 8, 17, 12, 0, 0)
const DAY = 86_400_000

/** Date.UTC wraps month 13 into the next year: a date is real only if it reads back as written. */
const real = (ms, m) => !Number.isNaN(ms) && new Date(ms).getUTCFullYear() === Number(m[1]) && new Date(ms).getUTCMonth() === Number(m[2]) - 1 && new Date(ms).getUTCDate() === Number(m[3])

const UNIT_MS = { m: 60_000, h: 3_600_000, d: DAY, w: 7 * DAY }

/** now plus `n` of `unit` (m h d w M y): months and years by the calendar, the rest by the clock. */
function shift(now, n, unit) {
  if (unit === "M" || unit === "y") {
    const d = new Date(now)
    d.setUTCMonth(d.getUTCMonth() + (unit === "y" ? 12 * n : n))
    return d.getTime()
  }
  return now + n * UNIT_MS[unit]
}

/** The start of the day, Monday-based week, month or year that holds `ms`. */
function startOf(period, ms) {
  const d = new Date(ms)
  const day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
  if (period === "Day") return day
  if (period === "Week") return day - ((d.getUTCDay() + 6) % 7) * DAY
  if (period === "Month") return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)
  return Date.UTC(d.getUTCFullYear(), 0, 1)
}

const NEXT = { Day: (ms) => ms + DAY, Week: (ms) => ms + 7 * DAY, Month: (ms) => shift(ms, 1, "M"), Year: (ms) => shift(ms, 1, "y") }
const OWN_UNIT = { Day: "d", Week: "w", Month: "M", Year: "y" }

/** `{ start, end, dayOnly }` in ms (a day runs start..end inclusive; an instant has start == end), or null when the text is not a date. */
export function parseWhen(text, now = NOW) {
  const raw = String(text).trim().replace(/^["']|["']$/g, "")
  if (/^now\(\)$/i.test(raw)) return { start: now, end: now, dayOnly: false }
  let m = /^([+-]?)(\d+)([mhdwMy])$/.exec(raw)
  if (m) {
    const at = shift(now, (m[1] === "-" ? -1 : 1) * Number(m[2]), m[3])
    return { start: at, end: at, dayOnly: false }
  }
  m = /^(startOf|endOf)(Day|Week|Month|Year)\(\s*(?:["']?([+-]?\d+)([mhdwMy])?["']?)?\s*\)$/.exec(raw)
  if (m) {
    const moved = m[3] === undefined ? now : shift(now, Number(m[3]), m[4] ?? OWN_UNIT[m[2]])
    const start = startOf(m[2], moved)
    const at = m[1] === "startOf" ? start : NEXT[m[2]](start) - 1
    return { start: at, end: at, dayOnly: false }
  }
  m = /^(\d{4})[-/](\d{2})[-/](\d{2})$/.exec(raw)
  if (m) {
    const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return real(start, m) ? { start, end: start + DAY - 1, dayOnly: true } : null
  }
  m = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?(Z)?$/.exec(raw)
  if (m) {
    const at = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0))
    return real(at, m) && Number(m[4]) < 24 && Number(m[5]) < 60 && Number(m[6] ?? 0) < 60 ? { start: at, end: at, dayOnly: false } : null
  }
  return null
}
