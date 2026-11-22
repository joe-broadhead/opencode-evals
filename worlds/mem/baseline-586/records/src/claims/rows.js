/**
 * Reading a claim row, shared by the log, the projections and the forget
 * cascade, so one row is shaped the same way wherever it is read.
 */
export function readClaim(row) {
  return {
    id: row.id,
    claim_key: row.claim_key,
    knowledge_key: row.knowledge_key,
    type: row.type,
    subject: row.subject,
    attribute: row.attribute,
    value: row.value,
    statement: row.statement,
    stated_by: row.stated_by,
    quote: row.quote,
    quotes: parseObject(row.quotes),
    statements: parseObject(row.statements),
    shared_quotes: parseList(row.shared_quotes),
    shared_statements: parseList(row.shared_statements),
    authors: parseObject(row.authors),
    refs: parseRefs(row.refs),
    source: row.source,
    version: row.version,
    state: row.state,
    first_seen: row.first_seen,
    last_seen: row.last_seen,
    count: Number(row.count),
  }
}

export function parseRefs(raw) {
  try {
    const parsed = JSON.parse(raw ?? "[]")
    return Array.isArray(parsed) ? parsed.filter((ref) => typeof ref === "string") : []
  } catch {
    return []
  }
}

export function parseObject(raw) {
  try {
    const parsed = JSON.parse(raw ?? "{}")
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function parseList(raw) {
  try {
    const parsed = JSON.parse(raw ?? "[]")
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
