// The privacy layer. A trace stored in this repository must hold no post text, handles, names, ids or
// links from X's results — the runs read the owner's real X account. So every string that reaches a
// trace is either provably structural (a timestamp, a number, a known parameter value) or is replaced by
// {len, shape, tokens}: a punctuation skeleton plus the words that belong to the tool's own grammar.
//
// The raw recording stays under evals-lab/private/ (mode 700) and is referenced by digest.

/** Values that are part of a tool's own language: never a user's content. */
export const VOCAB = new Set([
  "id", "ids", "username", "usernames", "name", "description", "created_at", "public_metrics", "entities",
  "author_id", "text", "media", "url", "urls", "mentions", "hashtags", "cashtags", "context_annotations",
  "referenced_tweets", "attachments", "poll_ids", "lang", "possibly_sensitive", "conversation_id",
  "reply_settings", "source", "withheld", "geo", "organic_metrics", "non_public_metrics", "promoted_metrics",
  "recency", "relevancy", "hour", "day", "minute", "hourly", "daily", "all", "any", "none", "asc", "desc",
  "recency_desc", "author_id,created_at,public_metrics", "username,name,public_metrics",
  "created_at,public_metrics", "attachments.media_keys", "referenced_tweets.id", "author_id",
  "get_users_me", "get_usage_credits", "search_posts_all", "search_users", "get_posts_by_id",
])

/** Query operators X's search grammar defines. Kept verbatim so a forbidden-operator check survives. */
export const QUERY_OPERATORS = new Set([
  "from", "to", "since", "until", "min_faves", "min_likes", "lang", "has", "is", "conversation_id", "url",
  "list", "retweets_of", "point_radius", "bounding_box", "place", "place_country", "hashtag", "cashtag",
])

const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/

/** A punctuation skeleton: operators keep their names, every other word and number is collapsed. */
export function shape(value) {
  const text = String(value ?? "")
  const mask = (segment) => segment.replace(/[A-Za-z]+/g, "w").replace(/\d+/g, "9")
  // Split on a word that is followed by ":", so an operator survives and everything else is masked.
  const parts = text.split(/([A-Za-z_-]+)(?=\s*:)/)
  let out = ""
  for (let i = 0; i < parts.length; i++) {
    const operator = i % 2 === 1
    if (operator) {
      const bare = parts[i].toLowerCase().replace(/^-/, "")
      out += QUERY_OPERATORS.has(bare) ? parts[i] : mask(parts[i])
    } else out += mask(parts[i])
  }
  out = out.replace(/(.)\1{2,}/g, "$1$1")
  return out.slice(0, 160)
}

/** The words in a value that belong to the tool's grammar; never the user's words. */
export function grammarTokens(value) {
  const words = String(value ?? "")
    .toLowerCase()
    .split(/[^a-z0-9_.]+/)
    .filter(Boolean)
  const found = new Set()
  for (const word of words) {
    if (QUERY_OPERATORS.has(word) || VOCAB.has(word)) found.add(word)
  }
  return [...found].sort()
}

const isIso = (s) => ISO.test(s)

/** One argument value, made safe to store. Numbers, booleans and timestamps survive; content does not. */
export function safeValue(key, value, keep = false) {
  if (value === null || value === undefined) return null
  if (keep) return value
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return { kind: "number", value: null }
    // A long integer is an id, not a count.
    return Math.abs(value) > 1e12 ? { kind: "id", digits: String(Math.trunc(value)).length } : value
  }
  if (typeof value === "boolean") return value
  if (Array.isArray(value)) return value.map((item) => safeValue(key, item))
  if (typeof value === "object") return { kind: "object", keys: Object.keys(value).sort() }
  const text = String(value)
  if (isIso(text)) return { kind: "timestamp", value: text }
  if (/^\d+$/.test(text) && text.length > 12) return { kind: "id", digits: text.length }
  const parts = text.split(",").map((p) => p.trim())
  if (parts.every((p) => VOCAB.has(p))) return text
  return { kind: "redacted", len: text.length, shape: shape(text), tokens: grammarTokens(text) }
}

/** Every argument of one tool call, made safe. `keep` names keys whose value is the plugin's own name. */
export function safeArgs(input, { keep = [] } = {}) {
  if (!input || typeof input !== "object") return {}
  const out = {}
  for (const key of Object.keys(input).sort()) {
    if (key === "code" && typeof input[key] === "string") {
      // Code Mode's program: the inner calls are extracted separately, so only its size is kept.
      out[key] = { kind: "code", len: input[key].length, lines: input[key].split("\n").length }
      continue
    }
    out[key] = safeValue(key, input[key], keep.includes(key))
  }
  return out
}

/**
 * Evidence strings and reasons are written by this tool, but they quote tool names, counts and sometimes
 * a matched phrase. Scrub the shapes that could carry a person: links, handles, long ids, quoted runs.
 */
export function redactEvidence(text) {
  return String(text ?? "")
    .replace(/https?:\/\/[^\s)"']+/g, "<link>")
    .replace(/@[A-Za-z0-9_]{1,15}\b/g, "<handle>")
    .replace(/\b\d{8,}\b/g, "<id>")
    .replace(/"[^"]{40,}"/g, '"<quoted>"')
}
