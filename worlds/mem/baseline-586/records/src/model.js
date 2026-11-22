/**
 * The record model (contract §2.3): kinds, types, statuses, fields, and the
 * checks a record passes before it is stored. Every message names the field
 * and the value to send instead.
 */
import { refused, invalid, tooLarge } from "./errors.js"
import { isInstructionShaped, unstorable } from "./curation.js"
import { storable } from "./storable.js"
import { RECORD_ID } from "./ids.js"
import { PATH } from "./links.js"
import { cut, titleFromBody, titleFromPath } from "./text.js"

export const KINDS = {
  memory: ["fact", "preference", "constraint", "decision", "procedure"],
  page: ["person", "project", "team", "topic", "runbook", "decision", "glossary", "journal", "index", "meeting"],
  commitment: ["commitment"],
  proposal: ["create", "append", "supersede", "merge", "link", "close_commitment", "open_commitment", "share", "team_write"],
}
export const STATUSES = ["current", "superseded", "retired", "contested", "proposed", "accepted", "rejected", "accepting", "applied", "applied_private", "declined"]
/** What a read shows by default. */
export const DEFAULT_STATUSES = ["current", "contested"]
export const STATED_BY = ["person", "agent", "inferred", "external"]
export const COMMITMENT_STATES = ["open", "done", "cancelled"]
/**
 * Where a record came from. `conversation`, `line`, `author` and `at` are a
 * saved line's own citation (#58 A14, `memory.saveLine`): the conversation and
 * the line in it, who wrote it and when. None of them is a record id, so none
 * becomes a graph edge (`#writeEdges` links only `event`, `turn` and `record`).
 */
const SOURCE_KEYS = ["session", "turn", "event", "url", "routine", "record", "conversation", "line", "author", "at"]

export const LIMITS = {
  title: 300,
  body: 256 * 1024,
  fieldsBytes: 32 * 1024,
  task: 200,
  supersedes: 20,
  listItems: 50,
  listItem: 200,
  fieldLinks: 200,
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-](\d{2}):(\d{2}))$/

export function isDate(value) {
  if (typeof value !== "string" || !DATE.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
}
export function isDateOrDateTime(value) {
  if (typeof value !== "string") return false
  if (isDate(value)) return true
  const match = DATETIME.exec(value)
  return Boolean(match && isDate(match[1]) && Number(match[2]) <= 23 && Number(match[3]) <= 59 && Number(match[4] ?? 0) <= 59 && Number(match[5] ?? 0) <= 23 && Number(match[6] ?? 0) <= 59 && !Number.isNaN(Date.parse(value)))
}

/**
 * The page type a new page's path implies, by the vault convention (contract
 * §2.3: `people/` a person, `projects/` a project, …). A page proposed at a
 * path the store has never seen takes this type, so a proposal cannot create a
 * page type the model does not hold.
 */
export function pageTypeForPath(path) {
  const value = String(path ?? "")
  if (value === "index") return "index"
  const folder = value.split("/")[0]
  return (
    {
      people: "person",
      projects: "project",
      teams: "team",
      topics: "topic",
      runbooks: "runbook",
      decisions: "decision",
      journal: "journal",
      glossary: "glossary",
      meetings: "meeting",
    }[folder] ?? "topic"
  )
}

export function checkPath(path, what = "path") {  if (typeof path !== "string" || !PATH.test(path)) {
    throw invalid(
      "invalid_path",
      `${JSON.stringify(path ?? null)} is not a valid ${what}. A page path is 1 to 4 lowercase segments of letters, digits and hyphens, each at most 64 characters.`,
      'Send a path such as "projects/harbour", "people/ama-owusu" or "journal/2026-11-08".',
    )
  }
  return path
}

export function checkKindType(kind, type) {
  if (typeof kind !== "string" || !Object.hasOwn(KINDS, kind)) {
    throw invalid("invalid_kind", `"${kind}" is not a record kind.`, `Send kind as one of ${Object.keys(KINDS).join(", ")}.`)
  }
  if (!KINDS[kind].includes(type)) {
    throw invalid("invalid_type", `"${type}" is not a type of ${kind}.`, `For kind ${kind}, send type as one of ${KINDS[kind].join(", ")}.`)
  }
}

function checkString(value, field, max) {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw invalid("invalid_record", `${field} must be a string.`, `Send ${field} as text.`)
  if (value.length > max) throw invalid("invalid_record", `${field} is ${value.length} characters; the limit is ${max}.`, `Shorten ${field}.`)
  return value
}

function checkStringList(value, field, maxItems = LIMITS.listItems, maxItem = LIMITS.listItem) {
  if (value === undefined || value === null) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw invalid("invalid_record", `${field} must be a list of strings.`, `Send ${field} as ["…", "…"].`)
  }
  if (value.length > maxItems) throw invalid("invalid_record", `${field} has ${value.length} items; the limit is ${maxItems}.`, `Send at most ${maxItems}.`)
  for (const item of value) {
    if (item.length > maxItem) throw invalid("invalid_record", `An item of ${field} is longer than ${maxItem} characters.`, `Shorten it.`)
  }
  return value
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Check the fields of a record of `kind`, in place on a copy. Known keys are
 * type-checked; other keys are kept as they are.
 */
export function checkFields(kind, fields) {
  if (fields === undefined || fields === null) return {}
  if (!isPlainObject(fields)) throw invalid("invalid_record", "fields must be an object.", "Send fields as {…}, or leave it out.")
  // A null field means "no value": it is dropped, never stored.
  const out = Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== null && value !== undefined))
  if (Buffer.byteLength(JSON.stringify(out)) > LIMITS.fieldsBytes) {
    throw tooLarge(`fields is larger than ${LIMITS.fieldsBytes / 1024} KiB.`, "Keep fields to metadata and put text in the body.")
  }
  checkStringList(out.aliases, "fields.aliases")
  checkStringList(out.tags, "fields.tags")
  checkStringList(out.links, "fields.links", LIMITS.fieldLinks)
  // An identity is a handle, or several for one network: a merge adds beside an
  // existing identity rather than overwriting it (J4 review, finding 1).
  const identityOk = (value) => typeof value === "string" || (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === "string"))
  if (out.identities !== undefined && (!isPlainObject(out.identities) || Object.values(out.identities).some((value) => !identityOk(value)))) {
    throw invalid("invalid_record", "fields.identities must map a network to a handle, such as {\"github\": \"ama\"}.", "Send each identity as a string, or a list of strings for one network.")
  }
  if (out.edited !== undefined && typeof out.edited !== "boolean") throw invalid("invalid_record", "fields.edited must be true or false.", "Send a boolean.")
  if (out.date !== undefined && !isDate(out.date)) throw invalid("invalid_record", "fields.date must be YYYY-MM-DD.", "Send a date such as 2026-11-08.")
  for (const key of ["confirmed_at", "valid_from", "valid_until", "closed_at", "expires"]) {
    if (out[key] !== undefined && out[key] !== null && !isDateOrDateTime(out[key])) {
      throw invalid("invalid_record", `fields.${key} must be a date (YYYY-MM-DD) or a date-time with an offset.`, "Send a date such as 2026-11-08.")
    }
  }
  if (kind === "commitment") {
    checkString(out.what, "fields.what", 300)
    checkString(out.owner, "fields.owner", 80)
    checkString(out.trigger, "fields.trigger", 200)
    checkString(out.project, "fields.project", 80)
    checkString(out.link, "fields.link", 500)
    if (out.due !== undefined && out.due !== null && out.due !== "" && !isDateOrDateTime(out.due)) {
      throw invalid("invalid_record", "fields.due must be YYYY-MM-DD or a date-time with an offset.", "Resolve the date first, then send it as 2026-11-06 or 2026-11-06T15:00:00+00:00.")
    }
    if (out.state !== undefined && !COMMITMENT_STATES.includes(out.state)) {
      throw invalid("invalid_record", `fields.state is one of ${COMMITMENT_STATES.join(", ")}, not "${out.state}".`, "Send open, done or cancelled.")
    }
  }
  if (kind === "proposal") {
    checkString(out.reason, "fields.reason", 2000)
    checkString(out.target_path, "fields.target_path", 300)
    if (out.target_id !== undefined && out.target_id !== null && !RECORD_ID.test(String(out.target_id))) {
      throw invalid("invalid_record", "fields.target_id must be a record id (rec_…).", "Send the id of the record the proposal changes.")
    }
    if (out.evidence !== undefined) {
      if (!Array.isArray(out.evidence) || out.evidence.length > 20 || out.evidence.some((item) => !isPlainObject(item))) {
        throw invalid("invalid_record", "fields.evidence must be a list of at most 20 {event|turn|record, quote}.", "Send the citations the proposal rests on.")
      }
      // A quote is text like any other: the store's guards apply to it (J4
      // review, finding 6). A quote holding an instruction or payment material
      // is refused whole; the rest are masked as an automatic write is.
      out.evidence = out.evidence.map((item) => {
        const quote = typeof item.quote === "string" ? item.quote : ""
        if (!quote) return item
        const verdict = unstorable(quote, "commitment")
        if (verdict || isInstructionShaped(quote)) {
          throw refused(verdict?.message ?? "Not stored: the cited quote holds an instruction.", verdict?.next ?? "Cite the sentence that does not command the reader.", { reason: verdict?.reason ?? "instruction" })
        }
        return { ...item, quote: storable(quote, "routine").text }
      })
    }
  }
  if (kind === "memory" && out.copied_from !== undefined && !isPlainObject(out.copied_from)) {
    throw invalid("invalid_record", "fields.copied_from must be {space, id, by, at}.", "Send the copy's provenance as an object.")
  }
  return out
}

/** Merge a fields patch: a key set to null is removed. */
export function mergeFields(current, patch) {
  if (patch === undefined) return { ...current }
  const out = { ...current }
  for (const [key, value] of Object.entries(patch ?? {})) {
    if (value === null) delete out[key]
    else out[key] = value
  }
  return out
}

function checkSource(source, actor) {
  if (source === undefined || source === null) return actor.session ? { session: actor.session } : {}
  if (!isPlainObject(source)) throw invalid("invalid_record", "source must be an object such as {\"session\": \"ses_…\", \"turn\": \"msg-…\"}.", "Send source as an object, or leave it out.")
  const out = {}
  for (const [key, value] of Object.entries(source)) {
    if (!SOURCE_KEYS.includes(key)) {
      throw invalid("invalid_record", `source.${key} is not a source key.`, `Send only ${SOURCE_KEYS.join(", ")}.`)
    }
    if (value === null || value === undefined || value === "") continue
    if (typeof value !== "string" || value.length > 500) throw invalid("invalid_record", `source.${key} must be a string of at most 500 characters.`, "Send it as text.")
    out[key] = value
  }
  if (!out.session && actor.session) out.session = actor.session
  return out
}

function checkSupersedes(value) {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string" || !RECORD_ID.test(id))) {
    throw invalid("invalid_record", "supersedes must be a list of record ids (rec_…).", "Send the ids of the records this one replaces.")
  }
  if (value.length > LIMITS.supersedes) throw invalid("invalid_record", `supersedes lists ${value.length} ids; the limit is ${LIMITS.supersedes}.`, "Supersede fewer records at once.")
  return [...new Set(value)]
}

function checkBody(body, kind) {
  if (body === undefined || body === null) return ""
  if (typeof body !== "string") throw invalid("invalid_record", "body must be Markdown text.", "Send body as a string.")
  if (body.length > LIMITS.body) {
    throw tooLarge(`The ${kind}'s body is ${body.length} characters; the limit is ${LIMITS.body}.`, "Split it into several pages and link them with [[path]].")
  }
  return body
}

function checkStatus(status, kind) {
  if (status === undefined || status === null) return kind === "proposal" ? "proposed" : "current"
  if (!STATUSES.includes(status)) throw invalid("invalid_status", `"${status}" is not a status.`, `Send one of ${STATUSES.join(", ")}.`)
  return status
}

/** The routines' own user (access.js ROUTINE_USER; repeated to keep this module free of access rules). */
const ROUTINE_USER = "routines"

/**
 * True when a write may be stored as the person's own statement (slice 7
 * follow-up, synthesis theme 1): a browser session the gateway vouches for
 * (`x-records-credential: session`), which is also the only held-write accept
 * that speaks for the person (the console's), or the routines' auto-apply in
 * auto mode (set by the routines in process, never by a header). A bearer's
 * claim is not enough, in a held batch or anywhere else: any editor bearer can
 * send `held_batch`, and nothing in it shows the person accepted anything.
 */
export function mayStatePerson(actor) {
  return actor?.credential === "session" || (actor?.user === ROUTINE_USER && actor?.autoApply === true)
}

/** Why a claimed `person` was stored as `agent`; the store returns it as `provenance`. */
export const PERSON_CLAIM_REASON = "stated_by person is kept only from a browser session (the console, including its held-write accept) or the routines in auto mode"

function checkStatedBy(value, actor) {
  const vouched = mayStatePerson(actor)
  if (value === undefined || value === null) return actor?.credential === "session" ? "person" : "agent"
  if (!STATED_BY.includes(value)) throw invalid("invalid_record", `stated_by is one of ${STATED_BY.join(", ")}, not "${value}".`, "Send person when the person said it, agent when you concluded it.")
  return value === "person" && !vouched ? "agent" : value
}

/** Commitment bookkeeping: `what` is the title, `state` defaults to open, closing stamps `closed_at`. */
function commitmentFields(fields, title, nowIso, previous) {
  const out = { ...fields }
  if (!out.what && title) out.what = title
  if (!out.owner) out.owner = "user"
  if (!out.state) out.state = "open"
  if (out.due === "") delete out.due
  if (out.state === "open") delete out.closed_at
  else if (!out.closed_at || previous?.state === "open") out.closed_at = nowIso
  return out
}

/**
 * A new record from the caller's input: checked, defaults filled. Ids,
 * versions, authorship and links are set by the store.
 */
export function newRecord(input, actor, nowIso, proposalTtlDays) {
  if (!isPlainObject(input)) throw invalid("invalid_record", "record must be an object.", "Send {record: {kind, type, body, …}}.")
  const kind = input.kind
  const type = input.type ?? (kind === "commitment" ? "commitment" : kind === "proposal" ? input.fields?.action : undefined)
  checkKindType(kind, type)
  let path = null
  if (kind === "page") {
    if (input.path === undefined || input.path === null) throw invalid("invalid_path", "A page needs a path.", 'Send a path such as "projects/harbour".')
    path = checkPath(input.path)
  } else if (input.path !== undefined && input.path !== null) {
    throw invalid("invalid_path", `A ${kind} has no path; only pages do.`, kind === "memory" ? "Leave path out: a memory is addressed by its id and exported as memories/<id>.md." : "Leave path out.")
  }
  const body = checkBody(input.body, kind)
  let fields = checkFields(kind, input.fields)
  let title = checkString(input.title, "title", LIMITS.title) ?? ""
  if (kind === "commitment") {
    if (!title) title = typeof fields.what === "string" ? fields.what : titleFromBody(body, 300)
    if (!title) throw invalid("invalid_record", "A commitment needs what will be done.", 'Send fields.what (or title), such as "Send the Q4 numbers to Ama".')
    fields = commitmentFields(fields, title, nowIso)
  }
  if (kind === "proposal") {
    fields.action = type
    if (!fields.expires) fields.expires = new Date(Date.parse(nowIso) + proposalTtlDays * 86_400_000).toISOString()
    if (!title) title = cut(`${type}: ${fields.target_path ?? fields.target_id ?? titleFromBody(typeof fields.payload?.body === "string" ? fields.payload.body : "")}`.trim(), 200)
  }
  if (!title) title = kind === "page" ? titleFromPath(path) : titleFromBody(body)
  const task = checkString(input.task, "task", LIMITS.task)
  const owner = checkString(input.owner, "owner", 200)
  return {
    kind,
    type,
    path,
    title,
    body,
    status: checkStatus(input.status, kind),
    stated_by: checkStatedBy(input.stated_by, actor),
    fields,
    supersedes: checkSupersedes(input.supersedes),
    source: checkSource(input.source, actor),
    task: task || null,
    owner: owner || actor.user,
  }
}

/**
 * The record after an update: keys the caller sent replace the current ones
 * (fields merge; a null field is removed). Kind and path do not change here.
 */
export function updatedRecord(current, input, actor, nowIso) {
  if (!isPlainObject(input)) throw invalid("invalid_record", "record must be an object.", "Send {record: {id, base_version, …}}.")
  if (input.kind !== undefined && input.kind !== current.kind) {
    throw invalid("invalid_record", `A record's kind does not change (this one is a ${current.kind}).`, "Create a new record of the other kind, and retire this one.")
  }
  if (input.path !== undefined && input.path !== current.path) {
    throw invalid("invalid_path", "A page's path changes only through records.move, which also rewrites the links to it.", `Call records.move with {id: "${current.id}", path: "…"}.`)
  }
  const type = input.type ?? current.type
  checkKindType(current.kind, type)
  const body = input.body === undefined ? current.body : checkBody(input.body, current.kind)
  const title = input.title === undefined ? current.title : checkString(input.title, "title", LIMITS.title) ?? ""
  if (input.fields !== undefined && input.fields !== null && !isPlainObject(input.fields)) {
    throw invalid("invalid_record", "fields must be an object.", "Send only the fields to change; a field set to null is removed.")
  }
  let fields = input.fields === undefined || input.fields === null ? { ...current.fields } : checkFields(current.kind, mergeFields(current.fields, input.fields))
  if (current.kind === "commitment") {
    if (input.title !== undefined && input.fields?.what === undefined) fields.what = title
    fields = commitmentFields(fields, fields.what ?? title, nowIso, current.fields)
  }
  const next = {
    ...current,
    type,
    title: title || (current.kind === "commitment" ? fields.what : current.title),
    body,
    fields,
    status: input.status === undefined ? current.status : checkStatus(input.status, current.kind),
    // Re-sending the stored value keeps it; a new claim of person needs mayStatePerson.
    stated_by: input.stated_by === undefined || input.stated_by === current.stated_by ? current.stated_by : checkStatedBy(input.stated_by, actor),
    source: input.source === undefined ? current.source : checkSource(input.source, actor),
    task: input.task === undefined ? current.task : checkString(input.task, "task", LIMITS.task) || null,
    owner: input.owner === undefined ? current.owner : checkString(input.owner, "owner", 200) || current.owner,
  }
  if (input.supersedes !== undefined) next.supersedes = checkSupersedes(input.supersedes)
  if (current.kind === "commitment" && fields.what && !input.title) next.title = fields.what
  return next
}
