/**
 * The deterministic daily passes (memory-funnel-v1.md §6, passes 1–3):
 * noise filter, thread folding, entity linking. No model, no writes.
 *
 * Every source item becomes one or more *segments* (a meeting is split by
 * speaker) under a citable ref: `msg-…` for a turn, `evt_…` for an event.
 * External text is redacted before it can reach the model (guards.js).
 */
import { createHash } from "node:crypto"
import { agentActor, authorOf, clip, matchesRule, noiseReason, redactExternal } from "./guards.js"

const MAX_ITEMS_PER_UNIT = 12
const MAX_SEGMENT_CHARS = 1500

/**
 * The fingerprint of one unit: a hash over the refs it was read with, sorted so
 * the order the store returned them does not matter. A thread that gains a
 * message is a different unit and is read again (FINDINGS §7.2).
 */
export function unitFingerprint(refs) {
  return createHash("sha256").update([...refs].sort().join("|")).digest("hex").slice(0, 32)
}
const SPEAKER_LINE = /^\s*([A-Z][\p{L}0-9 .'’-]{0,40}?)\s*:\s+(\S.*)$/u
/** The actor roles that attribute speech to one person (the contract's own free role word). */
const SPEAKING_ROLE = new Set(["speaker", "microphone", "channel"])
/**
 * The kinds that are a meeting written down rather than written by its speaker:
 * `meeting`, and any kind whose last segment is a note, notes, summary,
 * transcript, minutes or recording, with or without a vendor's namespace
 * (`x-granola/note`, `x-fireflies/summary`, `x-otter/recording`, a bare `note`).
 */
const MEETING_SEGMENT = /^(?:note|notes|summary|transcript|minutes|recording)$/i

function isMeetingKind(kind) {
  const value = String(kind ?? "").trim()
  if (!value) return false
  return MEETING_SEGMENT.test(value.split("/").pop() ?? "") || value.toLowerCase() === "meeting"
}

/**
 * True when an event is speech someone else wrote down (design §6): a meeting,
 * a transcript, or an event the plugin attributes to a speaker. The person's
 * own words in one are proposed, never applied, because whoever kept the notes
 * can write them.
 */
function isMeetingSpeech(event) {
  if (isMeetingKind(event?.kind)) return true
  const from = authorOf(event)
  return Boolean(from && SPEAKING_ROLE.has(String(from.role ?? "").toLowerCase()))
}

export function slugify(text) {
  return (
    String(text ?? "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "unnamed"
  )
}

/** Lookup keys for an actor id: the id itself and its bare value. */
export function actorKeys(id) {
  const value = String(id ?? "").trim().toLowerCase()
  if (!value) return []
  const keys = new Set([value])
  const m = /^([a-z][a-z0-9+.-]*):(.+)$/.exec(value)
  if (m) {
    const bare = m[2].replace(/^\/\//, "")
    keys.add(bare)
    if (bare.startsWith("@")) keys.add(bare.slice(1))
  }
  return [...keys]
}

/**
 * The canonical form of an actor id, its namespace included: lower case, one
 * scheme (its aliases resolved), no leading `@`. Two ids name the same account
 * only when these are equal, so a bare value (`joe@example.com`) or another
 * namespace never equals `mailto:joe@example.com` (design §6).
 */
export const SCHEME_ALIAS = Object.freeze({ gh: "github", twitter: "x" })

export function canonicalId(id) {
  const value = String(id ?? "").trim().toLowerCase()
  const m = /^([a-z][a-z0-9+.-]*):(.+)$/.exec(value)
  if (!m) return ""
  const scheme = SCHEME_ALIAS[m[1]] ?? m[1]
  const bare = m[2].replace(/^\/\//, "").replace(/^@/, "").trim()
  return bare ? `${scheme}:${bare}` : ""
}

const IDENTITY_SCHEME = Object.freeze({ email: "mailto", mail: "mailto", twitter: "x", gh: "github" })

/**
 * The scheme of a source's own actor ids (design §6, trust review H5): what a
 * confirmed identity must be for it to name the person on that binding. A
 * Linear issue's actor is `linear:…`, never the mail address a plugin also
 * knows the person by, so one plugin cannot make the person the author of
 * another's text. An unknown source falls back to its own owner id's scheme.
 */
export const SOURCE_SCHEME = Object.freeze({
  gmail: "mailto",
  gws: "mailto",
  mail: "mailto",
  outlook: "mailto",
  calendar: "mailto",
  granola: "mailto",
  drive: "mailto",
  slack: "slack",
  x: "x",
  twitter: "x",
  github: "github",
  gh: "github",
  linear: "linear",
  jira: "jira",
  notion: "notion",
})

/** The canonical actor id of one identity on a person page: {email: "a@b"} → mailto:a@b. */
export function canonicalIdentity(kind, value) {
  const k = String(kind ?? "").trim().toLowerCase()
  const v = String(value ?? "").trim().replace(/^@/, "")
  if (!k || !v) return ""
  return canonicalId(`${IDENTITY_SCHEME[k] ?? k}:${v}`)
}

/** Lookup keys for one identity on a person page: {email: "a@b"} → mailto:a@b, a@b. */
export function identityKeys(kind, value) {
  const v = String(value ?? "").trim().toLowerCase()
  if (!v) return []
  const k = String(kind).toLowerCase()
  const bare = v.replace(/^(?:mailto|slack|x|github|linear|gh):/, "").replace(/^@/, "")
  const keys = new Set([v, bare])
  if (k === "email") keys.add(`mailto:${bare}`)
  else if (k === "x" || k === "twitter") {
    keys.add(`x:@${bare}`)
    keys.add(`@${bare}`)
  } else keys.add(`${k}:${bare}`)
  return [...keys]
}

/**
 * The entity index the linking pass and the prompt use.
 * @param {{people: any[], projects: any[]}} pages person and project page records
 */
export function buildIndex({ people = [], projects = [] }) {
  const byIdentity = new Map()
  const byName = new Map()
  for (const p of people) {
    for (const [kind, value] of Object.entries(p.fields?.identities ?? {})) {
      for (const v of Array.isArray(value) ? value : [value]) for (const key of identityKeys(kind, v)) byIdentity.set(key, p.path)
    }
    for (const name of [p.title, ...(p.fields?.aliases ?? [])]) {
      const n = String(name ?? "").trim().toLowerCase()
      if (n) byName.set(n, p.path)
    }
  }
  const projectNames = []
  for (const p of projects) {
    for (const name of [p.title, ...(p.fields?.aliases ?? []), ...(p.fields?.tags ?? [])]) {
      const n = String(name ?? "").trim()
      if (n.length >= 3) projectNames.push({ path: p.path, re: new RegExp(`(?:^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^\\p{L}\\p{N}]|$)`, "iu") })
    }
  }
  // A person a batch's text names, though no actor identifies them.
  const personNames = []
  for (const p of people) {
    for (const name of [p.title, ...(p.fields?.aliases ?? [])]) {
      const n = String(name ?? "").trim()
      if (n.length >= 3) personNames.push({ path: p.path, re: new RegExp(`(?:^|[^\\p{L}\\p{N}])${n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^\\p{L}\\p{N}]|$)`, "iu") })
    }
  }
  return {
    people: people.map((p) => ({ path: p.path, title: p.title })),
    projects: projects.map((p) => ({ path: p.path, title: p.title })),
    personFor(id) {
      for (const key of actorKeys(id)) if (byIdentity.has(key)) return byIdentity.get(key)
      return null
    },
    personNamed(name) {
      return byName.get(String(name ?? "").trim().toLowerCase()) ?? null
    },
    peopleIn(text) {
      const value = String(text ?? "")
      const found = new Set()
      for (const { path, re } of personNames) if (re.test(value)) found.add(path)
      return [...found]
    },
    projectsIn(text) {
      const found = new Set()
      for (const { path, re } of projectNames) if (re.test(text)) found.add(path)
      return [...found]
    },
    has(path) {
      return people.some((p) => p.path === path) || projects.some((p) => p.path === path)
    },
  }
}

/**
 * Who the space's person is (design §6): their memory user id, a label, and
 * the actor ids Memory itself accepts as them.
 *
 * An actor is the person when its full id, in its own namespace, equals the
 * owner of the bound account that delivered the event (`sources.list`'s
 * `owner.id`), or an identity the person confirmed in the console (the index
 * page's `identities`). Never a bare value, another namespace, a display name
 * or a speaker line: `actorKeys` is for linking a person page, never for this.
 * The person's identities are never taken from events.
 */
export function personFrom({ user, label, sources = [], identities = {}, names = [], shared = false }) {
  // One owner id per binding, by the binding's own (source, account).
  const owners = new Map()
  // A row that names no source still names the person: its id's scheme is the
  // one binding scheme it can be theirs on (design §6, and the shape
  // `routines-rank.test.js` binds a rank-1 unit with). Such a row names no
  // account either, so the account cannot be honoured for it: an id of the
  // binding's scheme is theirs on that binding, and an id of another scheme
  // never is. A real source row always names its source and account, and the
  // pair above decides it.
  const unbound = new Map()
  for (const s of sources) {
    if (!s || s.status === "refused") continue
    const owner = canonicalId(s.owner?.id ?? s.owner_id ?? (typeof s.owner === "string" ? s.owner : ""))
    const source = typeof s.source === "string" ? s.source.trim().toLowerCase() : ""
    if (!owner) continue
    if (!source) {
      unbound.set(owner.slice(0, owner.indexOf(":")), owner)
      continue
    }
    owners.set(`${source}\u0000${String(s.account ?? "").trim().toLowerCase()}`, owner)
  }
  // What the person confirmed in the console, on any binding.
  const confirmed = new Set()
  for (const [kind, value] of Object.entries(identities ?? {})) {
    for (const v of Array.isArray(value) ? value : [value]) {
      const id = canonicalIdentity(kind, v)
      if (id) confirmed.add(id)
    }
  }
  const nameSet = new Set([label, ...names].filter(Boolean).map((n) => String(n).trim().toLowerCase()))
  /**
   * `about` is the binding that delivered the text: `{source, account}`. On that
   * binding the person is its own owner id, or a confirmed identity of the
   * source's own scheme — never another source's (design §6, trust review H5).
   */
  function isSelf(id, about = {}) {
    const value = canonicalId(id)
    if (!value) return false
    const source = typeof about?.source === "string" ? about.source.trim().toLowerCase() : ""
    if (!source) return false
    const owner = owners.get(`${source}\u0000${String(about.account ?? "").trim().toLowerCase()}`)
    if (owner && owner === value) return true
    // The binding's own scheme decides a row that named no source: an id of
    // that scheme is theirs, and an id of another binding's scheme never is.
    const bindingScheme = SOURCE_SCHEME[source] ?? ""
    if (bindingScheme && unbound.get(bindingScheme) === value) return true
    if (!confirmed.has(value)) return false
    const scheme = SOURCE_SCHEME[source] ?? (owner ? owner.slice(0, owner.indexOf(":")) : "")
    return Boolean(scheme) && value.startsWith(`${scheme}:`)
  }
  return {
    user: user ?? null,
    shared: Boolean(shared),
    label: label || "the person",
    owners,
    confirmed,
    isSelf,
    /** The confirmed identities alone: a caller with no binding to ask about. */
    isSelfId: (id) => isSelf(id),
    isSelfName: (name) => nameSet.has(String(name ?? "").trim().toLowerCase()),
  }
}

/** Who wrote a span the person pasted or quoted: never the person (FABLE records #4). */
export const PASTED = Object.freeze({ id: null, name: "pasted or quoted text", self: false, external: true, pasted: true, path: null })

const FENCE = /^\s*(?:```|~~~)/
const QUOTED_LINE = /^\s*>/
// The start of a forwarded, quoted or pasted message: everything after it is pasted.
// Each of these is evidence on its own line.
const FORWARD_START = [
  /^\s*-{2,}\s*(?:forwarded|original)\s+message\s*-{0,}\s*$/i,
  /^\s*begin forwarded message\s*:?\s*$/i,
  /^\s*on\s.{3,200}\swrote:\s*$/i,
  /^\s*<\s*(?:pasted[_ -]?content|quote|blockquote|email|document)\b[^>]*>/i,
  // One header line that only a message has: From:, Sent:, Subject:, Reply-To:.
  /^\s*(?:from|sent|subject|reply-to)\s*:\s*\S/i,
  // A chat line with its time in brackets: "[10:42 AM] Sam Lee: …".
  /^\s*\[\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]m)?\]\s/i,
]
// "On Tue, … Sam Lee <" wrapped onto a second line ending in "wrote:".
const ON_LINE = /^\s*on\s.{3,200}$/i
const WROTE_END = /\bwrote:\s*$/i
// Other header lines (To:, Cc:, Date:) start a message only two in a row.
const HEADER_LINE = /^\s*(?:from|sent|to|cc|bcc|subject|date|reply-to)\s*:\s*\S/i

// Weaker marks, evidence only with something else (the person writes "Hi
// Claude," and "Standup at 10:30" and rules of dashes themselves):
// a rule counts next to header lines; a greeting when a header, a signature or
// a quoted block follows; a "Name  10:42 AM" line in a transcript of two or more.
const RULE = /^\s*[_=-]{10,}\s*$/
const GREETING = /^\s*(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\b[^.!?\n]{0,40},\s*$/i
const SIGNATURE = /^\s*(?:thanks|thank you|many thanks|regards|kind regards|best regards|best|cheers|sincerely|yours)\s*(?:,\s*[\p{L}][\p{L} .'’-]{0,40})?,?\s*$/iu
const CHAT_STAMP = /^\s*\p{Lu}[\p{L}.'’-]*(?: \p{Lu}[\p{L}.'’-]*){0,3}\s+\d{1,2}:\d{2}\s?[AaPp]\.?[Mm]\.?\s*$/u

/** True when line `i` starts a pasted message, judging by the lines around it. */
function startsPaste(lines, i) {
  const line = lines[i]
  const ahead = lines.slice(i + 1)
  if (FORWARD_START.some((re) => re.test(line))) return true
  if (ON_LINE.test(line) && WROTE_END.test(lines[i + 1] ?? "")) return true
  if (HEADER_LINE.test(line) && HEADER_LINE.test(lines[i + 1] ?? "")) return true
  if (RULE.test(line)) return HEADER_LINE.test(lines[i + 1] ?? "")
  if (GREETING.test(line)) return ahead.some((l) => HEADER_LINE.test(l) || SIGNATURE.test(l) || QUOTED_LINE.test(l))
  if (CHAT_STAMP.test(line)) return ahead.some((l) => CHAT_STAMP.test(l))
  return false
}

/**
 * A user turn split into the person's own words and what they pasted or
 * quoted: block quotes, fenced blocks, forwarded or replied-to messages, and
 * email header blocks with what follows them. Pasted spans are external text:
 * they are redacted like an email and never applied as the person's statement.
 *
 * @returns {Array<{pasted: boolean, text: string}>}
 */
export function splitPasted(content) {
  const lines = String(content ?? "").split(/\r?\n/)
  const parts = []
  const push = (pasted, line) => {
    const last = parts[parts.length - 1]
    if (last && last.pasted === pasted) last.text += `\n${line}`
    else parts.push({ pasted, text: line })
  }
  let fenced = false
  let rest = false
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    if (rest) {
      push(true, line)
      continue
    }
    if (FENCE.test(line)) {
      fenced = !fenced
      push(true, line)
      continue
    }
    if (fenced || QUOTED_LINE.test(line)) {
      push(true, line)
      continue
    }
    if (startsPaste(lines, i)) {
      rest = true
      push(true, line)
      continue
    }
    push(false, line)
  }
  return parts.map((p) => ({ pasted: p.pasted, text: p.text.trim() })).filter((p) => p.text)
}

/** The binding that delivered an event: `{source, account}`, the person's owner id's namespace. */
function bindingOf(event) {
  return { source: event?.source ?? "", account: event?.account ?? "" }
}

/**
 * Who the person is for one actor id on one binding (design §6). A plugin's
 * own `self: false` downgrades; its `self: true` is never an upgrade.
 */
export function isSelfActor(person, id, binding, hint) {
  if (hint === false) return false
  if (typeof person?.isSelf === "function") return person.isSelf(id, binding)
  return Boolean(person?.isSelfId?.(id))
}

function eventAuthor(event, person, index) {
  const from = authorOf(event)
  const binding = bindingOf(event)
  // The plugin wrote this event; nothing in it makes its author the person but
  // Memory's own rule, a forged `kind: "session"` included.
  if (!from) return { id: null, name: event.kind === "bookmark" ? "unknown author" : "unknown", self: false, external: true }
  const self = isSelfActor(person, from.id, binding, from.self)
  // An agent, a bot or a service is never a person, even when a page exists for
  // it in an older space: the unit does not link to it (FINDINGS R3).
  return { id: from.id ?? null, name: from.name ?? from.id ?? "unknown", self, external: !self, meeting: self && isMeetingSpeech(event), path: self || agentActor(from) ? null : index.personFor(from.id) }
}

/**
 * A meeting's text, split into speaker segments when it has `Name: text` lines.
 * A segment is the person's only when the plugin attributes it to an actor with
 * a speaking role whose id passes Memory's rule (design §6): the notes' lines
 * and the person's own display name are not, because whoever writes the notes
 * can write them.
 */
function meetingSegments(event, person, index) {
  const actors = Array.isArray(event.actors) ? event.actors : []
  const binding = bindingOf(event)
  const speakers = actors.filter((a) => SPEAKING_ROLE.has(String(a.role ?? "").toLowerCase()) && a.id)
  const segments = []
  // A transcript of one person's own words has no `Name:` lines at all: its
  // whole text is the speaker the plugin named, not a note taker's.
  if (!String(event.text ?? "").split(/\r?\n/).some((line) => SPEAKER_LINE.test(line))) return [{ author: eventAuthor(event, person, index), text: String(event.text ?? "") }]
  for (const line of String(event.text ?? "").split(/\r?\n/)) {
    const m = SPEAKER_LINE.exec(line)
    if (m) {
      const name = m[1].trim()
      const actor = speakers.find((a) => String(a.name ?? "").toLowerCase() === name.toLowerCase())
      const self = actor ? isSelfActor(person, actor.id, binding, actor.self) : false
      const path = self || (actor && agentActor(actor)) ? null : actor ? index.personFor(actor.id) ?? index.personNamed(name) : index.personNamed(name)
      segments.push({ author: { id: actor?.id ?? null, name, self, external: !self, meeting: self, path }, text: m[2] })
    } else if (line.trim() && segments.length > 0) {
      segments[segments.length - 1].text += ` ${line.trim()}`
    } else if (line.trim()) {
      segments.push({ author: { id: null, name: "notes", self: false, external: true, path: null }, text: line.trim() })
    }
  }
  return segments.length > 0 ? segments : [{ author: eventAuthor(event, person, index), text: String(event.text ?? "") }]
}

function unitKey(item) {
  if (item.type === "turn") return `session:${item.session ?? "none"}`
  if (item.kind === "meeting") return `meeting:${item.ref}`
  return `${item.source}:${item.thread || item.ref}`
}

/**
 * What one unit costs a call: its segments plus the per-item frame, the same
 * arithmetic `batchUnits` uses.
 */
export function unitCost(unit) {
  return (unit.items ?? []).reduce((sum, item) => sum + (item.segments ?? []).reduce((t, seg) => t + seg.text.length + 120, 0), 0)
}

/** At most this share of a run's data may be coding sessions (FINDINGS R1). */
export const MAX_SESSION_SHARE = 0.4

/**
 * Coding sessions take at most `MAX_SESSION_SHARE` of a run's data: they are
 * the largest units and the least likely to hold someone else's promise, so the
 * rest wait for the next run or for catch-up (FINDINGS R1). A day that fits one
 * call is read whole: the cap shares out a scarce run, it does not starve a day.
 *
 * @returns {{units: any[], deferred: number}}
 */
export function capSessions(units, maxChars = 24_000) {
  const total = units.reduce((sum, unit) => sum + unitCost(unit), 0)
  if (total <= maxChars) return { units, deferred: 0 }
  const allowed = total * MAX_SESSION_SHARE
  let used = 0
  let deferred = 0
  const out = []
  for (const unit of units) {
    if (!(unit.kind === "session" || String(unit.key ?? "").startsWith("session:"))) {
      out.push(unit)
      continue
    }
    const cost = unitCost(unit)
    if (used + cost > allowed) {
      deferred += 1
      continue
    }
    used += cost
    out.push(unit)
  }
  // A run always sends something: when only sessions remain and the oldest is
  // over the share by itself, it goes anyway, so the cap can never hold a day
  // still for good (review finding H4).
  if (out.length === 0 && units.length > 0) return { units: [units[0]], deferred: units.length - 1 }
  return { units: out, deferred }
}

/**
 * The class a unit is read in (FINDINGS R1): 1 for the person's own words and
 * what was addressed to them, 2 for the conversations that concern them (a
 * meeting they spoke in, a message that names them), 3 for the rest.
 */
function unitRank(list, person) {
  // Which class a unit is read in. `self` here is a *reading* order, not
  // authorship: a name-only speaker line is a hint that the meeting is theirs
  // to read first, while nothing it contains is filed as their words (design
  // §6 keeps the strict rule for `author.self`).
  const self = (item) =>
    (item.segments ?? []).some((seg) => seg.author?.self || (!seg.author?.id && person.isSelfName?.(seg.author?.name)))
  const mine = (item, a) => isSelfActor(person, a?.id, bindingOf(item), a?.self)
  const addressed = (item) => (item.actors ?? []).some((a) => ["to", "cc"].includes(String(a?.role)) && mine(item, a))
  // A role that is not authorship still names them: a mention, an attendee, an
  // assignee, a reviewer. It reads as a reply to them without their words in it.
  const named = (item) =>
    (item.actors ?? []).some((a) => a?.id && mine(item, a) && !["from", "author", "sender", "speaker", "to", "cc"].includes(String(a.role)))
  const spoke = list.some((item) => item.kind === "meeting" && self(item))
  if (spoke) return 2
  if (list.some(self) || list.some(addressed)) return 1
  return list.some(named) ? 2 : 3
}

/**
 * The passes 1–3 over one day.
 *
 * @param {{turns: any[], events: any[], person: ReturnType<typeof personFrom>, rules: any[], index: ReturnType<typeof buildIndex>}} input
 */
export function prepareDay({ turns = [], events = [], person, rules = [], index }) {
  const dropped = []
  const withheld = []
  const items = []
  const counts = {}

  for (const t of turns) {
    const content = String(t.content ?? "").trim()
    if (!content) continue
    let author
    if (t.role === "assistant") author = { id: `agent:${t.agent_id ?? "agent"}`, name: t.agent_id ? `agent ${t.agent_id}` : "the agent", self: false, external: false, agent: true }
    else {
      // In a shared space no member is "the person": their statements wait for review.
      const self = !person.shared && (!person.user || !t.user_id || t.user_id === person.user)
      author = { id: t.user_id ? `user:${t.user_id}` : null, name: self ? person.label : String(t.user_id), self, external: !self }
    }
    // The person's own words are theirs; what they pasted or quoted is not.
    const segments = author.self ? splitPasted(content).map((part) => ({ author: part.pasted ? PASTED : author, text: part.text })) : [{ author, text: content }]
    // The turn's own (user, agent) pair travels with it: a held claim is asked
    // for by that pair, never by a listing that may miss an unregistered agent.
    items.push({ type: "turn", ref: t.id, source: "session", kind: "session", session: t.session_id, at: t.at, user_id: t.user_id ?? null, agent_id: t.agent_id ?? null, title: null, url: null, labels: [], actors: [], segments })
  }

  for (const e of events) {
    const author = eventAuthor(e, person, index)
    const reason = noiseReason(e, author.external)
    if (reason) {
      dropped.push({ ref: e.id, source: e.source, reason })
      continue
    }
    // A message the person sent often quotes the one it replies to: only their own words are theirs.
    const segments =
      isMeetingSpeech(e)
        ? meetingSegments(e, person, index)
        : author.self
          ? splitPasted(e.text).map((part) => ({ author: part.pasted ? PASTED : author, text: part.text }))
          : [{ author, text: String(e.text ?? "") }]
    if (segments.length === 0) segments.push({ author, text: "" })
    items.push({ type: "event", ref: e.id, source: e.source, account: e.account ?? null, kind: e.kind, thread: e.thread, at: e.occurred_at, title: e.title ?? null, url: e.url ?? null, labels: e.labels ?? [], actors: e.actors ?? [], segments })
  }

  // Thread folding: one unit per thread, session or meeting.
  const groups = new Map()
  for (const item of items) {
    const key = unitKey(item)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(item)
  }
  const ordered = [...groups.entries()]
    .map(([key, list]) => ({
      key,
      list,
      rank: unitRank(list, person),
      at: list.reduce((m, i) => (i.at && i.at < m ? i.at : m), "9999"),
    }))
    // The person's threads first, then what concerns them, then the rest; inside
    // a class the oldest first (FINDINGS R1). A day of chatter no longer spends
    // the run before a message addressed to the person.
    .sort((a, b) => a.rank - b.rank || (a.at < b.at ? -1 : a.at > b.at ? 1 : a.key < b.key ? -1 : 1))

  const units = []
  const refs = new Map()
  const actorUnits = new Map()
  const nameMatches = new Map()

  for (const { key, list, rank } of ordered) {
    const sorted = list.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    const oldest = sorted[sorted.length - 1]
    const title = oldest.title ?? (oldest.type === "turn" ? `Session: ${clip(oldest.segments[0].text, 60)}` : oldest.kind)
    const authors = sorted.flatMap((i) => i.segments.map((s) => s.author))
    const haystack = [oldest.source, title, key, ...sorted.flatMap((i) => i.labels), ...authors.map((a) => `${a.name} ${a.id ?? ""}`)].join(" ")
    const rule = rules.find((r) => matchesRule(r, haystack, null))
    if (rule) {
      for (const i of list) dropped.push({ ref: i.ref, source: i.source, reason: `preference: ${rule.text}` })
      continue
    }
    const uid = `u${units.length + 1}`
    const unit = { uid, key, kind: oldest.kind, source: oldest.source, title: clip(title, 140), at: oldest.at, rank, items: [], people: new Set(), projects: new Set(), external: false }
    let projectText = title
    for (const item of sorted.slice(0, MAX_ITEMS_PER_UNIT)) {
      const segments = item.segments.map((s) => {
        let text = clip(s.text, MAX_SEGMENT_CHARS)
        if (s.author.external) {
          const red = redactExternal(text)
          for (const r of red.removed) withheld.push({ ref: item.ref, source: item.source, ...r })
          text = red.text
          unit.external = true
        }
        return { author: s.author, text }
      })
      // The same rule as the author's (design §6): the person's own id, on the binding that delivered it.
      const addressed = item.actors.some((a) => ["to", "cc"].includes(String(a.role)) && a.id && isSelfActor(person, a.id, bindingOf(item), a.self))
      unit.items.push({ ref: item.ref, type: item.type, kind: item.kind, at: item.at, segments, addressed })
      refs.set(item.ref, {
        ref: item.ref,
        type: item.type,
        kind: item.kind,
        source: item.source,
        unit: uid,
        title: item.title ? clip(item.title, 140) : null,
        url: item.url,
        at: item.at,
        ...(item.type === "turn" ? { user_id: item.user_id ?? null, agent_id: item.agent_id ?? null } : {}),
        segments,
      })
      counts[item.source] = (counts[item.source] ?? 0) + 1
      projectText += ` ${segments.map((s) => s.text).join(" ")}`
      for (const s of segments) if (s.author.path) unit.people.add(s.author.path)
      // Bookmark authors are reading, not people the person deals with; and a
      // sender whose text carried an unsafe shape never becomes a page.
      const suspect = item.kind === "bookmark" || withheld.some((w) => w.ref === item.ref)
      for (const a of item.actors) {
        if (!a?.id || isSelfActor(person, a.id, bindingOf(item), a.self)) continue
        // An agent, a bot or a service is never a person: it is never collected
        // for a person page (FINDINGS R3, people/build).
        if (agentActor(a)) continue
        if (suspect && !index.personFor(a.id)) continue
        const path = index.personFor(a.id)
        if (path) unit.people.add(path)
        else if (a.name && index.personNamed(a.name)) nameMatches.set(a.id, { id: a.id, name: a.name, path: index.personNamed(a.name) })
        else if (/^[a-z][a-z0-9+.-]*:/i.test(a.id)) {
          const entry = actorUnits.get(a.id) ?? { id: a.id, name: a.name ?? null, units: new Set(), authored: false, refs: [] }
          entry.units.add(uid)
          if (["from", "author", "sender", "speaker"].includes(String(a.role))) entry.authored = true
          entry.refs.push(item.ref)
          if (!entry.name && a.name) entry.name = a.name
          actorUnits.set(a.id, entry)
        }
      }
    }
    for (const p of index.projectsIn(projectText)) unit.projects.add(p)
    // What the unit is read by: its refs, and the fingerprint a read mark keeps.
    unit.refs = unit.items.map((i) => i.ref)
    unit.fingerprint = unitFingerprint(unit.refs)
    units.push(unit)
  }

  const newPeople = [...actorUnits.values()]
    .map((a) => ({ id: a.id, name: a.name, units: a.units.size, uids: [...a.units], authored: a.authored, refs: [...new Set(a.refs)] }))
    .sort((a, b) => b.units - a.units || (a.id < b.id ? -1 : 1))

  return {
    units: units.map((u) => ({ ...u, people: [...u.people], projects: [...u.projects] })),
    refs,
    dropped,
    withheld,
    counts,
    newPeople,
    nameMatches: [...nameMatches.values()],
  }
}

/** The text of one ref the model saw (all segments), for quote checks. */
export function refText(info) {
  return info ? info.segments.map((s) => s.text).join("\n") : ""
}

/**
 * The author of the segment of a ref that holds a quote. A quote no single
 * segment holds, or one a non-self segment also holds, is not the person's:
 * the fallback is external (FABLE records #4). Nor is a quote the person only
 * reports, inside quotation marks ('Bob said "…"').
 */
export function quoteAuthor(info, quote, fold) {
  if (!info) return null
  const q = fold(quote)
  const holding = info.segments.filter((s) => fold(s.text).includes(q))
  if (holding.length === 0) return { id: null, name: "unknown", self: false, external: true, path: null }
  const other = holding.find((s) => !s.author?.self)
  if (other) return other.author
  const reported = holding.every((s) => {
    const text = fold(s.text)
    return text.includes(`"${q}`) || text.includes(`${q}"`)
  })
  return reported ? { id: null, name: "reported speech", self: false, external: true, path: null } : holding[0].author
}
