// Markdown source -> a draft. One screen per case, reviewable by a person; the compile step turns it into
// the strict JSON a runner and a grader consume.
//
// Format (see cases/x/small-bounded-search.md):
//   # id
//   - Key: value            (Plugin, Skill under test, Tier, Source, Decision tested, Data check, Controls, Budget, Expect)
//   ## Prompt               free text
//   ## Items                "- [ID] severity · ask" then indented "key: value" lines
//   ## Forbidden            the same, and every item is a forbidden action
//   ## Oracle               "- path == value"
//   ## Notes                "- ID: why a hand grade may differ"

export class ParseError extends Error {
  constructor(file, message, line) {
    super(`${file}:${line ?? "?"}: ${message}`)
    this.name = "ParseError"
  }
}

const FIELDS = new Map([
  ["plugin", "plugin"],
  ["skill under test", "skill"],
  ["tier", "tier"],
  ["source", "source"],
  ["decision tested", "decision"],
  ["data check", "dataCheck"],
  ["controls", "controls"],
  ["budget", "budget"],
  ["expect", "expect"],
  ["holdout", "holdout"],
  ["seed", "seed"],
  ["checkable", "checkable"],
  ["set", "set"],
  ["status", "status"],
])

const ITEM_KEYS = new Set(["maps_to", "evidence", "evidence_any", "n/a_when", "grader", "where", "note"])

export function parseCase(file, text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n")
  const draft = { file, fields: {}, prompt: "", items: [], oracle: [], notes: [], unknown: [] }
  let section = "header"
  let current = null
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trimEnd()
    const lineNo = i + 1
    if (!line.trim()) continue
    if (line.startsWith("# ")) {
      draft.id = line.slice(2).trim()
      continue
    }
    if (line.startsWith("## ")) {
      if (current) draft.items.push(current)
      section = line.slice(3).trim().toLowerCase()
      current = null
      if (!["prompt", "items", "forbidden", "oracle", "notes"].includes(section)) {
        draft.unknown.push({ section, line: lineNo })
      }
      continue
    }
    if (section === "header") {
      const m = /^-\s*([A-Za-z][A-Za-z ]*?):\s*(.*)$/.exec(line)
      if (!m) throw new ParseError(file, `expected "- Key: value", got ${JSON.stringify(line)}`, lineNo)
      const key = FIELDS.get(m[1].trim().toLowerCase())
      if (!key) throw new ParseError(file, `unknown header key ${JSON.stringify(m[1])}`, lineNo)
      draft.fields[key] = m[2].trim()
      continue
    }
    if (section === "prompt") {
      draft.prompt += (draft.prompt ? "\n" : "") + raw
      continue
    }
    if (section === "notes") {
      const m = /^-\s*([A-Z]+-[A-Z]{2}\d{2})\s*:\s*(.+)$/.exec(line.trim())
      if (m) draft.notes.push({ id: m[1], text: m[2].trim(), line: lineNo })
      else draft.notes.push({ id: null, text: line.replace(/^-\s*/, "").trim(), line: lineNo })
      continue
    }
    if (section === "oracle") {
      const m = /^-\s*(.+?)\s+(==|!=)\s+(.+)$/.exec(line.trim())
      if (!m) throw new ParseError(file, `expected "- path == value", got ${JSON.stringify(line)}`, lineNo)
      draft.oracle.push({ path: m[1].trim(), op: m[2], value: m[3].trim(), line: lineNo })
      continue
    }
    // Items and Forbidden share the same shape.
    const forbidden = section === "forbidden"
    const item = /^-\s*\[([^\]]+)\]\s*(blocker|major|minor)\s*(?:·|\||:)\s*(.+)$/.exec(line.trim())
    if (item) {
      if (current) draft.items.push(current)
      current = { id: item[1].trim(), severity: item[2], ask: item[3].trim(), forbidden, line: lineNo, maps_to: [], evidence: [], evidence_any: [], na_when: [] }
      continue
    }
    const sub = /^\s+(?:-\s*)?([a-z_/]+):\s*(.+)$/.exec(raw)
    if (sub && current) {
      const key = sub[1]
      if (!ITEM_KEYS.has(key)) throw new ParseError(file, `unknown item key ${JSON.stringify(key)}`, lineNo)
      const value = sub[2].trim()
      if (key === "evidence") current.evidence.push({ text: value, line: lineNo })
      else if (key === "evidence_any") current.evidence_any.push({ text: value, line: lineNo })
      else if (key === "n/a_when") current.na_when.push({ text: value, line: lineNo })
      else if (key === "maps_to") current.maps_to.push(...value.split(",").map((s) => s.trim()).filter(Boolean))
      else if (key === "grader") current.grader = value
      else if (key === "where") current.where = value
      else if (key === "note") current.note = value
      continue
    }
    throw new ParseError(file, `unexpected line in "${section}": ${JSON.stringify(line)}`, lineNo)
  }
  if (current) draft.items.push(current)
  return draft
}

/** `- Controls: no-skill (expect fail: X-PR02); old-version (expect pass)` */
export function parseControls(text) {
  if (!text) return []
  return text
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const m = /^([a-z-]+)(?:\s*\(expect\s+(pass|fail|partial)(?::\s*([^)]+))?\))?$/.exec(part)
      if (!m) return { kind: part, expect: "pass", on: [] }
      return { kind: m[1], expect: m[2] ?? "pass", on: (m[3] ?? "").split(",").map((s) => s.trim()).filter(Boolean) }
    })
}

/** `- Budget: outer_calls <= 4, tokens <= 120000` */
export function parseBudget(text) {
  if (!text) return {}
  const out = {}
  for (const part of text.split(",")) {
    const m = /^\s*([a-z_]+)\s+(<=|>=|==)\s+(\d+)\s*$/.exec(part)
    if (!m) throw new Error(`unreadable budget clause ${JSON.stringify(part)}`)
    out[m[1]] = Number(m[3])
  }
  return out
}
