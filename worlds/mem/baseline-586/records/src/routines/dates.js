/**
 * Local days, hours, weeks and months in a space's time zone (IANA), with
 * Node's Intl only. A "day" is the string YYYY-MM-DD; instants are Date or ISO.
 */

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
const formatters = new Map()

function formatter(tz) {
  let f = formatters.get(tz)
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    })
    formatters.set(tz, f)
  }
  return f
}

/** True when `tz` is an IANA zone Node knows. */
export function validTz(tz) {
  if (typeof tz !== "string" || !tz || tz.length > 80) return false
  try {
    formatter(tz)
    return true
  } catch {
    return false
  }
}

export function safeTz(tz) {
  return validTz(tz) ? tz : "UTC"
}

function parts(instant, tz) {
  const date = instant instanceof Date ? instant : new Date(instant)
  const out = {}
  for (const p of formatter(safeTz(tz)).formatToParts(date)) out[p.type] = p.value
  return {
    year: Number(out.year),
    month: Number(out.month),
    day: Number(out.day),
    hour: Number(out.hour) % 24,
    minute: Number(out.minute),
    second: Number(out.second),
  }
}

const pad = (n, w = 2) => String(n).padStart(w, "0")

export function isDay(value) {
  const m = DAY.exec(String(value ?? ""))
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3])
}

/** The local day of an instant. */
export function localDay(instant, tz) {
  const p = parts(instant, tz)
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`
}

export function localHour(instant, tz) {
  return parts(instant, tz).hour
}

/** Milliseconds the zone is ahead of UTC at an instant. */
function offsetAt(ms, tz) {
  const p = parts(new Date(ms), tz)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** The UTC instant of a local wall time (the earlier one in a fold). */
export function zonedToUtc(day, tz, hour = 0) {
  const m = DAY.exec(day)
  if (!m) throw new Error(`not a day: ${day}`)
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), hour)
  let guess = wall - offsetAt(wall, tz)
  guess = wall - offsetAt(guess, tz)
  return new Date(guess)
}

/** The UTC bounds [start, end) of a local day, as ISO strings. */
export function dayBounds(day, tz) {
  return { start: zonedToUtc(day, tz).toISOString(), end: zonedToUtc(addDays(day, 1), tz).toISOString() }
}

export function addDays(day, n) {
  const m = DAY.exec(day)
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + n))
  return d.toISOString().slice(0, 10)
}

/** ISO weekday: 1 Monday … 7 Sunday. */
export function weekday(day) {
  const m = DAY.exec(day)
  const w = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return w === 0 ? 7 : w
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000)
}

/** ISO 8601 week of a day: {year, week, monday}. */
export function isoWeek(day) {
  const monday = addDays(day, 1 - weekday(day))
  const thursday = addDays(monday, 3)
  const year = Number(thursday.slice(0, 4))
  const jan4 = `${year}-01-04`
  const firstMonday = addDays(jan4, 1 - weekday(jan4))
  return { year, week: daysBetween(firstMonday, monday) / 7 + 1, monday }
}

export function weekPath(day) {
  const { year, week } = isoWeek(day)
  return `journal/${year}-w${pad(week)}`
}

export function weekDays(day) {
  const { monday } = isoWeek(day)
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}

export function monthPath(day) {
  return `journal/${day.slice(0, 7)}`
}

export function monthDays(day) {
  const first = `${day.slice(0, 7)}-01`
  const out = []
  for (let d = first; d.slice(0, 7) === first.slice(0, 7); d = addDays(d, 1)) out.push(d)
  return out
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** "Monday 2 November 2026" */
export function longDay(day) {
  return `${WEEKDAYS[weekday(day) - 1]} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`
}

/** "Mon 2 Nov" */
export function shortDay(day) {
  return `${WEEKDAYS[weekday(day) - 1].slice(0, 3)} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1].slice(0, 3)}`
}

export function monthName(day) {
  return `${MONTHS[Number(day.slice(5, 7)) - 1]} ${day.slice(0, 4)}`
}

/** The day a commitment's `due` falls on (a day, or an offset date-time), in tz. */
export function dueDay(due, tz) {
  if (!due) return null
  const text = String(due)
  if (isDay(text)) return text
  const ms = Date.parse(text)
  return Number.isFinite(ms) ? localDay(new Date(ms), tz) : null
}
