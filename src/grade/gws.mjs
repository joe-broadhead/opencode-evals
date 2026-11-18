// What a `gws_plan` call would do, read from its own arguments (R6: `gws-plan:`).
//
// Google Workspace writes are committed with only a planId, so the call that names the operation and the target is
// `gws_plan`. The grader reads the operation, and the target (a mail's recipients, a file, a calendar, a sheet, a document or
// a task list) from the plan request: `{ operation, params, body, input }`. A Gmail request carries its message as a base64url
// RFC 822 `raw`; its `To`, `Cc` and `Bcc` headers are decoded, folded lines and `Name <address>` forms included.

/** A base64url (or base64) string as text, or null when it is not one. */
export function decodeRaw(raw) {
  if (typeof raw !== "string" || !raw) return null
  const text = raw.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, "")
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return null
  try {
    return Buffer.from(text, "base64").toString("utf8")
  } catch {
    return null
  }
}

/** The addresses in a header value: `A <a@one.example.org>, b@two.example.org` -> ["a@one.example.org", "b@two.example.org"]. */
export function addressesIn(value) {
  const out = []
  for (const part of String(value ?? "").split(",")) {
    const angle = /<([^<>\s]+@[^<>\s]+)>/.exec(part)
    const bare = /([^\s<>"',;()]+@[^\s<>"',;()]+)/.exec(part)
    const found = angle?.[1] ?? bare?.[1]
    if (found) out.push(found.toLowerCase())
  }
  return out
}

/** The recipients of an RFC 822 message: To, Cc and Bcc, in header order. Null when there is no header block. */
export function recipientsOf(message) {
  if (typeof message !== "string") return null
  const head = message.split(/\r?\n\r?\n/)[0]
  // Unfold: a header line that starts with whitespace continues the one before.
  const unfolded = head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/)
  const out = []
  let seen = false
  for (const line of unfolded) {
    const m = /^(to|cc|bcc):\s*(.*)$/i.exec(line)
    if (!m) continue
    seen = true
    out.push(...addressesIn(m[2]))
  }
  return seen ? out : null
}

const asList = (value) => (value === undefined || value === null || value === "" ? [] : Array.isArray(value) ? value.map(String) : [String(value)])

const ID_KEYS = ["fileId", "calendarId", "spreadsheetId", "documentId", "tasklist", "addParents", "folderId", "parentId", "messageId", "userId"]

/**
 * `{ operation, targets, why }` for one plan request. `targets` are the addresses of a mail, else the ids the request
 * touches; empty (with a reason) when nothing could be read, so a clause on it is unverifiable, never passed.
 */
export function gwsPlanFacts(args) {
  if (!args || typeof args !== "object" || "$ref" in args) return { operation: null, targets: [], why: "the plan request is a variable" }
  const operation = typeof args.operation === "string" ? args.operation : null
  const params = args.params && typeof args.params === "object" ? args.params : {}
  const body = args.body && typeof args.body === "object" ? args.body : {}
  const input = args.input && typeof args.input === "object" ? args.input : {}
  const isMail = /^gmail\./.test(operation ?? "")
  if (isMail) {
    const message = decodeRaw(body.raw) ?? decodeRaw(params.raw) ?? (typeof body.message?.raw === "string" ? decodeRaw(body.message.raw) : null)
    const decoded = message === null ? null : recipientsOf(message)
    if (decoded) return { operation, targets: decoded }
    // A helper call (`gmail +send --to a@one.example.org`) names its recipients in `input`.
    const flags = [...asList(input.to), ...asList(input.cc), ...asList(input.bcc)].flatMap(addressesIn)
    if (flags.length) return { operation, targets: flags }
    // A mail operation on an existing message or draft names no recipient (a label, a trash, a read).
    if (!/(send|draft)/i.test(operation ?? "")) return { operation, targets: [], why: "a mail operation that names no recipient" }
    return { operation, targets: [], why: "the message's recipients could not be decoded" }
  }
  const ids = []
  for (const key of ID_KEYS) ids.push(...asList(params[key]), ...asList(input[key]))
  ids.push(...asList(body.parents), ...asList(body.parentId))
  const targets = [...new Set(ids)]
  return targets.length ? { operation, targets } : { operation, targets: [], why: "the request names no file, calendar, sheet, document or list" }
}
