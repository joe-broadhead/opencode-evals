// The numbers a case's clauses were written from, checked against the world they run in (HARNESS-GAPS HG-14).
//
// A case whose evidence names a value the world derives (a session count, a cost, a session id) declares it:
//
//   - Truth: sql.avgCostByAgent[agent=build].avg_usd == 1.08; ids.stripe-v2 == ses_K9LjlYHCdsswNT1uhyTQqf
//
// A path is dotted keys, a list index (`.0`) or a list element picked by one of its fields (`[agent=build]`). The world
// names its truth file (world.json "truth"); a run whose world says otherwise is refused before anything is reserved,
// so a world change that moves a number cannot silently fail (or pass) the cases written from the old one.

const parseValue = (raw) => {
  const text = raw.trim()
  if (/^".*"$/.test(text) || /^'.*'$/.test(text)) return text.slice(1, -1)
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text)
  if (text === "true" || text === "false") return text === "true"
  if (text === "null") return null
  return text
}

/** `a.b[k=v].c == 1.08; d == x` -> [{path, value}]. Throws on a part that is not `path == value`. */
export function parseTruth(text) {
  return String(text)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^([A-Za-z0-9_.\-[\]=]+)\s*==\s*(.+)$/.exec(part)
      if (!m) throw new Error(`unreadable truth ${JSON.stringify(part)}: use <path> == <value>`)
      pathParts(m[1])
      return { path: m[1], value: parseValue(m[2]) }
    })
}

/** The steps of a path: a key, or a list element picked by a field. */
export function pathParts(path) {
  const parts = []
  const re = /([^.[\]]+)|\[([^=\]]+)=([^\]]+)\]/g
  let at = 0
  for (const m of String(path).matchAll(re)) {
    const gap = path.slice(at, m.index)
    if (gap && gap !== ".") throw new Error(`unreadable truth path ${JSON.stringify(path)}`)
    parts.push(m[1] !== undefined ? { key: m[1] } : { field: m[2], equals: parseValue(m[3]) })
    at = m.index + m[0].length
  }
  if (!parts.length || at !== path.length) throw new Error(`unreadable truth path ${JSON.stringify(path)}`)
  return parts
}

/** The value at a path, or undefined. */
export function truthAt(data, path) {
  let node = data
  for (const part of pathParts(path)) {
    if (node === null || node === undefined || typeof node !== "object") return undefined
    if (part.key !== undefined) node = node[part.key]
    else node = Array.isArray(node) ? node.find((element) => element && element[part.field] === part.equals) : undefined
  }
  return node
}

/** Every declared truth of these cases against the world's truth: the ones that hold and the ones that do not. */
export function checkTruth(cases, data) {
  const rows = []
  for (const caseObject of cases) {
    for (const claim of caseObject.truth ?? []) {
      const found = data ? truthAt(data, claim.path) : undefined
      rows.push({ case: caseObject.id, path: claim.path, expected: claim.value, found: found === undefined ? null : found, ok: found !== undefined && found === claim.value })
    }
  }
  return { rows, bad: rows.filter((row) => !row.ok) }
}

export const renderTruthProblem = (row) => `${row.case}: ${row.path} is ${row.found === null ? "absent from the world's truth" : JSON.stringify(row.found)}, the case was written for ${JSON.stringify(row.expected)}`
