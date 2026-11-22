/**
 * Who is speaking (J4 final check, the conservative rule).
 *
 * In the person's **own verified message**, a first-person promise is theirs
 * only when it sits **above the first reply-boundary line** and its line names
 * no other person. A boundary is generic: any line with an email address, a
 * date or time stamp, a speech verb in English, French, Spanish, German, Dutch
 * or Italian, a run of `-`/`_`/`=`, or a `>` quote. A line names another person
 * when it carries a capitalised name-like token before `,` `:` `-` or a speech
 * verb, a "with/from/per/by/according to <Name>", a possessive `<Name>'s`, or a
 * known person page's name or alias.
 *
 * **Otherwise the owner is unknown, and the promise is not proposed** (it is
 * counted as withheld). False negatives are accepted; false positives are not.
 *
 * The person is verified only by a connector field: a Slack sender id equal to
 * the binding's owner, a Gmail `sent` label from the bound account, a Calendar
 * organiser that is the owner. Never a name, a speaker line, a `From:` header, a
 * pasted chat header or a quote.
 */
import { authorOf } from "../routines/guards.js"

const EMAIL = /\b[\w.+-]+@[\w-]+\.[\w-]{2,}\b/
const TIME = /\b\d{1,2}[:.]\d{2}\b/
const DATE = /\b(?:\d{1,2}[\s./-]+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?|\d{4}-\d{2}-\d{2}|\d{1,2}[\s./-]+\d{1,2}[\s./-]+\d{2,4}|(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?,?\s+\d{1,2})\b/i
// "wrote", "said", "a écrit", "escribió", "schrieb", "schreef", "ha scritto".
const SPEECH = /\b(?:wrote|writes|said|says|a\s+écrit|écrit|escribió|dice|schrieb|sagte|schreef|zei|ha\s+scritto|scrive|scrisse)\b/iu
const RULE = /[-_=]{3,}/
const QUOTED = /^\s*>/
const NAME = String.raw`\p{Lu}[\p{L}'’-]*(?:\s+\p{Lu}[\p{L}'’-]*){0,3}`
// A label that opens a line is not a person: "Decision: we ship", "Outcome: …"
// and "Heads-up: …" are the sender's own words.
const LABEL = new Set(["decision", "decisions", "outcome", "outcomes", "agreed", "agreement", "summary", "status", "update", "updates", "note", "notes", "action", "actions", "risk", "risks", "blocker", "blockers", "next", "context", "result", "results", "proposal", "recommendation", "plan", "plans", "re", "heads-up", "headsup", "reminder", "question", "answer", "todo", "fyi", "brief", "agenda"])
const NAME_BEFORE_MARK = new RegExp(`(${NAME})\\s*(?:,|:|-|–|—)`, "u")
// A possessive or a speech verb anywhere ("Sam said…" needs no punctuation).
const NAMES_OTHER = [
  new RegExp(`${NAME}['’]s\\b`, "u"),
  SPEECH,
]
const labelName = (captured) => LABEL.has(String(captured ?? "").trim().toLowerCase())

// "by Friday", "from Monday", "de enero": a day or a month is a time, not a person.
const PREPOSITION_NAME = new RegExp(`\\b(?:with|from|per|by|according\\s+to|via|à|de|von|van|door|con|mit|met)\\s+(${NAME})`, "u")
const TIME_WORD = /^(?:(?:mon|tue|wed|thu|fri|sat|sun)(?:day|nesday|sday|rsday|urday)?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*|today|tomorrow|tonight|yesterday|next|this|last)$/i

/** True when a line ends the person's own text: a quoted or forwarded reply starts here. */
export function isBoundary(line) {
  const value = String(line ?? "")
  // A date or a time is a boundary only as a *header* ("Le mar. 25 nov. 2026 à
  // 07:30, …", "Sent: …"): the person's own sentence may name a day.
  const headerish =
    /^\s*\[?\d{1,2}[:.]\d{2}/.test(value) ||
    /^\s*(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*,?\s*)?\d{1,2}[\s./-]+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(value) ||
    /\b(?:at|à|um|a\s+las|om|il)\s+\d{1,2}[:.]\d{2}/i.test(value)
  const mailHeader = /^\s*(?:from|sent|to|cc|bcc|subject|date|reply-to|de|van|envoyé|enviado|gesendet|verzonden|da|oggetto)\s*:\s*\S/i.test(value)
  return EMAIL.test(value) || mailHeader || (headerish && (TIME.test(value) || DATE.test(value))) || SPEECH.test(value) || RULE.test(value) || QUOTED.test(value)
}

/** A name safe to store and to show: no address, no markup, at most 80 characters. */
export function displayName(raw) {
  const value = String(raw ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim()
  if (!value) return ""
  const bare = value.includes("@") ? value.split("@")[0] : value
  return bare.replace(/[^\p{L}\p{N} .'’-]/gu, "").trim().slice(0, 80)
}

/**
 * The sender actor a plugin put on the event, read as the contract reads an
 * author: the first `from`, or else the first `author` (source-contract #46 §1).
 * A `sender` or an `organizer` follows only when a page lists neither; a
 * `speaker` never does, because a speaker is not the sender.
 */
function senderOf(event) {
  const actors = (Array.isArray(event?.actors) ? event.actors : []).filter((actor) => actor && typeof actor === "object")
  for (const role of ["from", "author", "sender", "organizer"]) {
    const found = actors.find((actor) => String(actor.role) === role)
    if (found) return found
  }
  return null
}

/** True only when the connector's own field names the person (see the table above). */
export function verifiedSelf(event, job) {
  const ownerId = job?.owner_id ?? job?.owner?.id ?? null
  const sender = senderOf(event)
  const source = String(job?.source ?? event?.source ?? "")
  if (source === "gmail") {
    const labels = (Array.isArray(event?.labels) ? event.labels : []).map((label) => String(label).toLowerCase())
    return labels.includes("sent") && String(event?.account ?? "") === String(job?.account ?? event?.account ?? "")
  }
  if (!ownerId) return false
  if (source === "slack") {
    const role = String(sender?.role ?? "")
    if (role !== "from" && role !== "author") return false
    return typeof sender?.id === "string" && sender.id === ownerId && sender.id.startsWith("slack:")
  }
  if (source === "calendar") {
    // The owner id the binding confirmed, never an actor's `self` hint: the
    // source contract's `self` is a hint, and Memory alone decides who the
    // person is (source-contract #46 §1; the per-binding rule is slice S1's).
    const organiser = (Array.isArray(event?.actors) ? event.actors : []).find((actor) => String(actor?.role) === "organizer")
    return Boolean(organiser && organiser.id === ownerId)
  }
  return false
}

/**
 * A sender's name for an owner: the **verified** id or address, never the
 * display name a From header can spoof. An address gives its local part; no id
 * is "unknown" (an id-less Slack author never gets a name owner).
 */
export function ownerFromSender(sender) {
  const id = typeof sender?.id === "string" ? sender.id.trim() : ""
  if (!id) return "unknown"
  const bare = id.replace(/^[a-z][a-z0-9+.-]*:(?:\/\/)?/i, "")
  const local = bare.includes("@") ? bare.split("@")[0] : bare
  return displayName(local) || "unknown"
}

/** The name a *verified* other author owns their promises under. */
function verifiedName(event, job) {
  const sender = senderOf(event)
  if (String(job?.source ?? event?.source ?? "") === "gmail") return ownerFromSender(sender)
  // A Slack or Calendar actor name comes from the connector's API; no id is
  // still "unknown", never a display name on its own.
  if (!sender?.id) return "unknown"
  return displayName(sender.name) || ownerFromSender(sender)
}

/** True when a line names somebody other than the person. */
export function namesSomeone(line, job = {}) {
  const value = String(line ?? "")
  const marked = NAME_BEFORE_MARK.exec(value)
  if (marked && !labelName(marked[1]) && !TIME_WORD.test(marked[1].trim())) {
    // "Sam:" or "Sam -" names somebody; "Decision:" does not.
    if (!/^(?:I|we|my|our)\b/i.test(marked[1])) return true
  }
  const lowercaseSpeaker = /^\s*([a-z][a-z0-9._-]{1,20})\s*:\s+/.exec(value)
  if (lowercaseSpeaker && !labelName(lowercaseSpeaker[1])) return true
  if (NAMES_OTHER.some((pattern) => pattern.test(value))) return true
  const prep = PREPOSITION_NAME.exec(value)
  if (prep && !TIME_WORD.test(prep[1].trim()) && !labelName(prep[1])) return true
  const folded = value.toLowerCase()
  const known = (Array.isArray(job.known_names) ? job.known_names : []).map((name) => String(name ?? "").trim().toLowerCase()).filter(Boolean)
  return known.some((name) => name.length >= 3 && folded.includes(name))
}

/** The text of one event as spans, each with the speaker it belongs to. */
export function speakerSpans(event, job) {
  const text = String(event?.text ?? "")
  const self = verifiedSelf(event, job)
  const otherName = self ? null : verifiedName(event, job)
  const spans = []
  let boundary = false
  let relayBlock = false
  for (const line of text.split(/\r?\n/)) {
    // A blank line ends a relayed block; until then nothing is the person's.
    // A reply boundary is different: it runs to the end of the message.
    if (!boundary && line.trim() === "") relayBlock = false
    if (!boundary && isBoundary(line)) boundary = true
    if (boundary) {
      spans.push({ text: line.replace(/^\s*>\s?/, ""), speaker: { self: false, name: null, relayed: true, verified: self } })
      continue
    }
    if (relayBlock) {
      spans.push({ text: line, speaker: { self: false, name: null, relayed: true, verified: self } })
      continue
    }
    if (self && namesSomeone(line, job)) {
      // The person's own text, on a line that names somebody else: not theirs.
      spans.push({ text: line, speaker: { self: false, name: null, evidence: true, selfEvent: true, verified: true } })
      // "Notes copied from Sam's email:" or "From Ama:" opens a block that runs
      // until a blank line.
      if (/:\s*$/.test(line)) relayBlock = true
      continue
    }
    // A connector-provided sender (a scheme id, or an address) is verified even
    // when it is not the person: a colleague's own decision is still proposed.
    const verified = self || Boolean(senderOf(event)?.id)
    spans.push({ text: line, speaker: self ? { self: true, verified: true } : { self: false, name: otherName, verified } })
  }
  if (spans.length === 0) {
    const verified = self || Boolean(senderOf(event)?.id)
    spans.push({ text: "", speaker: self ? { self: true, verified: true } : { self: false, name: otherName, verified } })
  }
  return spans
}

/** Who spoke the quote: the speaker of the span that holds it. */
export function speakerOfQuote(spans, quote, fold) {
  const q = fold(String(quote ?? ""))
  const holding = (Array.isArray(spans) ? spans : []).filter((span) => q.length >= 3 && fold(span.text).includes(q))
  if (holding.length === 0) return { self: false, name: "unknown", unknown: true }
  const named = holding.find((span) => span.speaker && span.speaker.self === false && span.speaker.name)
  if (named) return { self: false, name: named.speaker.name }
  if (holding.some((span) => span.speaker?.evidence || span.speaker?.relayed)) return { self: false, name: null, unknown: true, evidence: true }
  const mine = holding.every((span) => span.speaker?.self === true)
  return mine ? { self: true, name: null } : { self: false, name: null, unknown: true }
}

/** The person, or the verified author's own name. */
export function speakerOf(event, job) {
  if (verifiedSelf(event, job)) return { self: true, name: job?.owner_label ?? job?.owner?.label ?? "the person" }
  return { self: false, name: verifiedName(event, job) }
}

/** The author record one span gets, for the frame's roles and the policy. */
export function authorFor(speaker, job) {
  if (speaker?.self) {
    return { id: job?.owner_id ?? job?.owner?.id ?? null, name: job?.owner_label ?? job?.owner?.label ?? "the person", self: true, external: false, agent: false, verified: true, pasted: false, path: null }
  }
  return {
    id: null,
    name: speaker?.name ?? "unknown",
    self: false,
    external: true,
    agent: false,
    pasted: Boolean(speaker?.relayed),
    ...(speaker?.evidence ? { evidence: true } : {}),
    ...(speaker?.selfEvent ? { selfEvent: true } : {}),
    verified: Boolean(speaker?.verified),
    path: null,
  }
}

/** The sender's name, for an event with no relayed span. */
export function senderName(event) {
  return ownerFromSender(authorOf(event))
}
