/**
 * Safety guards for the routines (memory-funnel-v1.md §7 last row, §10).
 *
 * External text (events, and turns from people other than the space's person)
 * is data. Anything in it shaped like an instruction, a permission or a share
 * is dropped and logged: never applied, never proposed. The patterns are
 * anchored on the phrasing of an injected command, not on single words, so an
 * ordinary "I'll share the deck on Monday" from a colleague survives.
 *
 * The instruction patterns start from the plugin's curation guards
 * (src/curation.js); the records service cannot import the plugin, so they are
 * repeated here and extended for text written by strangers.
 */

import { shapes } from "../shapes.js"

export { shapes }

export function shapeNames(s) {
  return ["instruction", "permission", "share"].filter((k) => s[k])
}

/** Sentences of a text, with hidden HTML comments as their own sentences. */
function sentences(text) {
  const out = []
  const value = String(text ?? "")
  let rest = value.replace(/<!--([\s\S]*?)-->/g, (_, inner) => {
    out.push({ text: `<!--${inner}-->`, hidden: true })
    return " "
  })
  rest = rest.replace(/<[^>]{0,200}>/g, " ")
  // A sentence ends at . ! or ? followed by a space or the end, or at a line
  // break: "0.3%", "4.99" and "a@b.example" stay whole.
  for (const part of rest.split(/(?<=[.!?])\s+|\n+/)) if (part.trim()) out.push({ text: part, hidden: false })
  return out
}

export const REMOVED = "[removed: instruction-shaped text]"

/**
 * External text as it may reach the model: hidden comments and markup are
 * removed, and each unsafe sentence is replaced with a marker.
 * @returns {{text: string, removed: Array<{shapes: string[], excerpt: string}>}}
 */
export function redactExternal(text) {
  const removed = []
  const kept = []
  for (const s of sentences(text)) {
    const found = shapes(s.text)
    if (s.hidden || found.any) {
      removed.push({ shapes: s.hidden ? ["hidden", ...shapeNames(found)] : shapeNames(found), excerpt: clip(s.text, 80) })
      if (kept[kept.length - 1] !== REMOVED) kept.push(REMOVED)
    } else kept.push(s.text.trim())
  }
  return { text: kept.join(" ").replace(/\s+/g, " ").trim(), removed }
}

export function clip(text, n) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim()
  return value.length > n ? `${value.slice(0, n - 1)}…` : value
}

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const LOCAL_PATH = /(?:^|\s)\/(?:Users|home|private\/var)\/[^\s]+/g

/**
 * One line of model or source text, safe for a Markdown page: no newlines, no
 * headings, no HTML comments or tags, no wiki links (the routine adds its own),
 * no email addresses or local paths.
 */
export function cleanLine(text, n = 280) {
  return clip(
    String(text ?? "")
      .replace(/<!--[\s\S]*?(?:-->|$)/g, " ")
      .replace(/<[^>]{0,200}>/g, " ")
      .replace(/\[\[|\]\]/g, "")
      .replace(/\[(?:turn|event)\s[^\]]*\]/gi, "")
      .replace(EMAIL, "[address]")
      .replace(LOCAL_PATH, " [path]")
      .replace(/^(?:#{1,6}\s+|>\s?|[-*+]\s+|\s+)+/, "")
      .replace(/[\r\n]+/g, " "),
    n,
  )
}

/** Text compared for quotes: whitespace, quotes and dashes folded, lowercase. */
export function fold(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

/** True when `quote` occurs verbatim (after folding) in `source`. */
export function quoteFound(quote, source) {
  const q = fold(quote)
  return q.length >= 3 && fold(source).includes(q)
}

// ---------------------------------------------------------------------------
// Noise (funnel §6 pass 1)

const NOISE_LABELS = new Set([
  "promotions",
  "category_promotions",
  "social",
  "category_social",
  "updates",
  "category_updates",
  "forums",
  "category_forums",
  "spam",
  "newsletter",
  "bulk",
  "notification",
  "notifications",
])
const NOISE_SENDER = /(?:^|[:/.@_-])(?:no-?reply|do-?not-?reply|notifications?|newsletters?|mailer-daemon|digest|bounces?|marketing|news|updates|alerts?)(?:[@._+-]|$)/i
const BOT_NAME = /(?:\bbot\b|\[bot\]|-bot$|\bbot$)/i
const UNSUBSCRIBE = /\bunsubscribe\b|\bview (?:this email )?in (?:your )?browser\b|\bmanage (?:your )?(?:email )?preferences\b/i

// An acknowledgement is a message that says nothing beyond hello or thanks.
const ACK = new Set([
  "hi", "hello", "hey", "hiya", "heya", "yo", "morning", "afternoon", "evening", "good", "dear",
  "thanks", "thank", "you", "thx", "ty", "ta", "cheers", "ok", "okay", "k", "kk", "sure", "cool",
  "nice", "great", "perfect", "noted", "ack", "acknowledged", "got", "it", "sounds", "+1", "👍", "🙏", "🎉",
  "all", "everyone", "folks", "team", "both", "there", "and", "hope", "well", "how", "are", "doing", "hows", "how's",
])

/**
 * True when a message is only a greeting or an acknowledgement: at most six
 * words, every one of them hello, thanks or agreement, so no number, date,
 * question or request can be inside it. Such a message yields nothing, and
 * paying the model for it is how a day runs out of budget (FINDINGS R3).
 */
export function isAcknowledgement(text) {
  const value = String(text ?? "").replace(/\s+/g, " ").trim()
  if (!value) return false
  const words = value.toLowerCase().split(/[\s,.!;:…~*_()[\]{}'"–—-]+/).filter(Boolean)
  return words.length > 0 && words.length <= 6 && words.every((w) => ACK.has(w))
}

// A scheme that is never a human identity: OpenCode agents (the history plugin
// names them `opencode-agent:<name>`), bots, services, tools.
const AGENT_SCHEMES = /^(?:agent|opencode-agent|bot|service|system|tool):/i
// The roles an actor can carry and still be no person.
const AGENT_ROLES = new Set(["agent", "bot", "service", "tool", "system"])
// The OpenCode agents whose names are never a person's.
const AGENT_NAMES = new Set(["build", "plan", "general", "explore"])

/**
 * True when an actor is an agent, a bot or a service, never a person: its role or
 * declared kind says so, its id or name is an OpenCode agent (the history plugin
 * names them `opencode-agent:<name>`), its scheme is agent/opencode-agent/bot/
 * service/tool, the history source marks it, or its id or name says bot
 * (FINDINGS R3, 0.12.5 review M).
 */
export function agentActor(actor) {
  if (!actor) return false
  if (actor.agent === true || actor.bot === true) return true
  // A role that is an agent, a bot or a service is never a person, whatever the
  // id looks like (0.12.5 review, M: `opencode-agent:docs`, role `agent`).
  if (AGENT_ROLES.has(String(actor.role ?? "").toLowerCase())) return true
  if (AGENT_ROLES.has(String(actor.kind ?? actor.type ?? "").toLowerCase())) return true
  const id = String(actor.id ?? "").trim()
  if (!id) return false
  if (AGENT_SCHEMES.test(id) || /^slack:B[A-Z0-9]+$/.test(id)) return true
  if (BOT_NAME.test(String(actor.name ?? "")) || BOT_NAME.test(id)) return true
  const bare = id.replace(/^[a-z][a-z0-9+.-]*:/i, "").replace(/^@/, "").trim().toLowerCase()
  const name = String(actor.name ?? "").trim().toLowerCase()
  return AGENT_NAMES.has(bare) || AGENT_NAMES.has(name)
}

/**
 * Why an event is noise, or "" to keep it. `authorExternal` is true when the
 * author is not the space's person.
 */
export function noiseReason(event, authorExternal) {
  const labels = (event.labels ?? []).map((l) => String(l).toLowerCase())
  if (labels.some((l) => NOISE_LABELS.has(l))) return "label"
  // Only the author makes an event noise. A bot, a notification address or an
  // automation in any other role is ignored, never fatal: a notetaker at a
  // meeting, a Cc on a mail and a bot a Slack message mentions say nothing
  // about the words written beside them (0.12.5 review, H). The actor in
  // another role is still not a person: `agentActor` keeps it out of a page.
  const from = authorOf(event)
  if (from) {
    if (from.bot === true || /^slack:B[A-Z0-9]+$/.test(String(from.id ?? ""))) return "bot"
    if (BOT_NAME.test(String(from.name ?? "")) || BOT_NAME.test(String(from.id ?? ""))) return "bot"
    if (NOISE_SENDER.test(String(from.id ?? ""))) return "automated sender"
  }
  // A message with a subject line is not a bare acknowledgement: its subject is
  // content, printed under Sources, and it is gated as a title (S1, design
  // §5.4). Only a message that says nothing but hello or thanks, with no
  // subject of its own, is noise.
  if (event.kind === "message" && !event.title && isAcknowledgement(event.text)) return "greeting"
  if (event.kind === "message" && authorExternal && UNSUBSCRIBE.test(String(event.text ?? ""))) return "newsletter"
  return ""
}

/**
 * A ranking, or a hire or no-hire judgement, about a candidate (design v3.1):
 * never knowledge. A hiring judgement belongs to the people making it, not to a
 * memory an agent recalls as a fact about a person. A decision that merely names
 * an option "candidate B" is work, and says none of these words.
 */
export const CANDIDATE_JUDGEMENT = [
  /\b(?:strong|weak|lean|definite|clear|safe)[ -]?hire\b/,
  /\bno[ -]?hire\b/,
  /\bhire\b[^.!?\n]{0,40}\bcandidate\b/,
  /\bcandidate\b[^.!?\n]{0,40}\bhire\b/,
  /\bcandidates?\b[^.!?\n]{0,40}\b(?:rank|ranking|ranked)\b/,
  /\b(?:rank|ranking|ranked)\b[^.!?\n]{0,40}\bcandidates?\b/,
  /\b(?:reject|rejected|decline|declined|pass on|passed on)\b (?:the |this |that )?candidate\b/,
  /\btop candidate\b/,
  /\bbest candidate\b/,
  /\b(?:first|second|third)[ -]choice candidate\b/,
]

/**
 * A source's own title, normalised for a comparison (design §5.4): mail clients
 * add `Re:`, `Fwd:` and their cousins, and a later title of the same thread is
 * the same subject. The gate drops the prefix so `Re: sick leave` is matched
 * where `sick leave` is.
 */
const TITLE_PREFIX = /^\s*(?:re|fwd|fw|aw|sv|vs)\s*(?:\[\d+\])?\s*:\s*/i

export function normaliseTitle(text) {
  let value = String(text ?? "").replace(/\s+/g, " ").trim()
  for (let i = 0; i < 8 && TITLE_PREFIX.test(value); i += 1) {
    const next = value.replace(TITLE_PREFIX, "").trim()
    if (next === value) break
    value = next
  }
  return value.toLowerCase()
}

/** True when a text is a ranking or a hire judgement about a candidate. */
export function candidateJudgement(text) {
  const value = normaliseTitle(text).normalize("NFKC")
  return CANDIDATE_JUDGEMENT.some((re) => re.test(value))
}

/**
 * Who the event's author is, as the source contract reads it (v0.3.0, #46 §1):
 * the first `from`, or else the first `author`. Older roles follow only when a
 * page lists neither, so a page that carries both settles on its `from`, and a
 * page with several `from` actors settles on the first — `one-author` is a
 * plugin's authoring-time check, never a page rule.
 */
export function authorOf(event) {
  const actors = (Array.isArray(event?.actors) ? event.actors : []).filter((actor) => actor && typeof actor === "object")
  for (const role of ["from", "author", "sender", "organizer", "speaker"]) {
    const found = actors.find((actor) => String(actor.role) === role)
    if (found) return found
  }
  return null
}

// ---------------------------------------------------------------------------
// "Don't journal …" preferences (funnel §6: "using the person's 'don't journal' preferences")

const PREF = /\b(?:don'?t|do not|never|stop|no need to)\s+(?:journal|log|track|record|keep|include|note|mention)\s+(?:any(?:thing)?\s+(?:from|about)\s+|the\s+|my\s+)?([^.!?\n]{2,120})/i
const GENERIC = new Set([
  "the", "a", "an", "from", "about", "of", "in", "on", "to", "and", "or", "any", "all", "my", "our",
  "messages", "message", "mails", "mail", "emails", "email", "posts", "post", "items", "stuff", "things",
  "channel", "channels", "anything", "everything", "them", "these", "those", "please", "again", "it",
])
const CATEGORY = { newsletter: "newsletter", newsletters: "newsletter", notifications: "notification", notification: "notification", bots: "bot", bot: "bot", promotions: "label", marketing: "label" }

/**
 * A reject rule from one preference memory: {terms, categories, text}, or null.
 * "Don't journal vendor newsletters" → terms ["vendor"], categories ["newsletter"].
 */
export function rejectRule(text) {
  const m = PREF.exec(String(text ?? ""))
  if (!m) return null
  const words = m[1]
    .toLowerCase()
    .replace(/[^a-z0-9#@._\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[.-]+|[.-]+$/g, ""))
    .filter(Boolean)
  const categories = []
  const terms = []
  for (const w of words) {
    if (CATEGORY[w]) categories.push(CATEGORY[w])
    else if (!GENERIC.has(w) && w.length >= 2) terms.push(w.replace(/^#/, ""))
  }
  if (terms.length === 0 && categories.length === 0) return null
  return { terms, categories, text: clip(text, 120) }
}

/** True when a unit's metadata matches a reject rule. */
export function matchesRule(rule, haystack, noiseKind) {
  const hay = String(haystack ?? "").toLowerCase()
  const termsOk = rule.terms.every((t) => hay.includes(t))
  if (rule.categories.length > 0) {
    const catOk = rule.categories.some((c) => c === noiseKind || hay.includes(c))
    return catOk && (rule.terms.length === 0 || termsOk)
  }
  return rule.terms.length > 0 && termsOk
}

// ---------------------------------------------------------------------------
// Wording checks the policy relies on (deterministic, on the verbatim quote)

export const DECISION_WORDING = /\b(?:we|i)(?:'ve| have|'re| are| will|'ll)?\s+(?:decided|agreed|chosen|chose|settled on|picked|going with|go with|gone with)\b|\b(?:decision|decided)\s*(?::|is|was)\b|\b(?:let'?s|we(?:'ll| will)) go with\b|\bgoing with\b|\bwe(?:'re| are) (?:going to )?(?:use|ship|switch|move)\b/i
export const FIRST_PERSON_COMMIT = /\b(?:i(?:'ll| will| shall|'m going to| am going to| can| promise to)|let me|i'?ll make sure)\s+\w+/i
export const COMPLETION_WORDING = /\b(?:sent|merged|done|shipped|deployed|completed|finished|delivered|closed|resolved|attached|published|submitted|here (?:are|is) the|here'?s the|as promised)\b/i
export const SELF_PREFERENCE = /\b(?:i\s+(?:prefer|like|want|always|never|hate|dislike|don'?t (?:like|want))|my (?:preference|rule|default)|please always|please never|i(?:'d| would) rather)\b/i
export const HEDGED = /\?|\b(?:maybe|might|perhaps|probably|i think|i guess|not sure|possibly|could be)\b/i
