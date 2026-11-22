/**
 * Copies of forgotten text (docs/design/adr-forget-copies.md).
 *
 * One fact is stored several times: the `mem_remember` request and its echo
 * (L0), the atoms the core extracts from them (L1), a captured turn that
 * repeats it (L0), and the atoms extracted from that turn (L1). Upstream does
 * not return an atom's source rows, and its extractor rewrites wording, so a
 * copy is found by the specific tokens a fact is made of (numbers, dates,
 * identifiers, quoted and capitalised names), which a rewrite keeps, and not
 * by verbatim text, which a rewrite changes.
 *
 * Everything here is a pure function of the text, except `readListing`, which
 * reads one bounded, newest-first listing through a caller-supplied reader.
 */

/** The request row `mem_remember` writes; recall never shows it. */
export const REMEMBER_WRAPPER = /^Please remember this (?:fact|decision|constraint|preference|procedure) for later: /
/** The assistant row `mem_remember` writes after the request. */
const REMEMBER_ECHO = /^Understood\. /
/** `mem_remember` appends the reason after this separator. */
const REASON_SEPARATOR = "\n\nContext: "
/** `mem_remember` writes under these synthetic sessions; captured turns use the host's session id. */
const REMEMBER_SESSION = /^(?:priv|team|space)-/
/** Rows recall hides as remember requests, in either format the plugin has written. */
const HIDDEN_FROM_RECALL = /^\s*(?:please remember this|\[mem:remember)/i

/**
 * Words that never make two texts the same fact: English function words and
 * the boilerplate of memory writes ("the user", "please remember", "context").
 * Generic on purpose: no product, project, or scenario word belongs here.
 */
const STOPWORDS = new Set(
  (
    "a an the and or but nor not no yes so if then than that this these those there here it its is are was were be been being " +
    "am do does did done doing have has had having will would shall should can could may might must ought of to in on at by " +
    "for from with without into onto over under about above below after before between during through until upon via per " +
    "as also just only very really still even again ever never always often sometimes now today tomorrow yesterday soon " +
    "i me my mine we us our ours you your yours he him his she her hers they them their theirs who whom whose which what " +
    "when where why how all any some each every both either neither more most less least other others another same such " +
    "own one ones use used uses using make made makes get got gets set sets need needs needed want wants like likes " +
    "user users team teams agent agents project projects someone something thing things note noted notes remember " +
    "remembered please later context understood fact facts decision decisions constraint constraints preference " +
    "preferences procedure procedures stated says said tell told know known think keep kept e.g i.e etc"
  ).split(/\s+/),
)

/** Most anchors and stems kept per text, so one long turn cannot make the scan quadratic. */
const MAX_ANCHORS = 40
const MAX_STEMS = 60
/** Text kept per forgotten row; the specific tokens of a fact sit well inside it. */
export const MAX_FORGOTTEN_CHARS = 2_000
/**
 * Characters of a candidate row read by `matchCopy` (and by recall's
 * fingerprint matcher, src/forgotten.js): a copy later in a longer row is not
 * found. It bounds the work per row.
 */
export const MAX_MATCH_CHARS = 8_000
/**
 * A long fact (more features than this) is a copy only where a proportion of
 * its features is shared: one number and a word in common do not make a row a
 * copy of a paragraph. Measured in docs/design/adr-forget-copies.md.
 */
export const PROPORTIONAL_ABOVE = 12
export const PROPORTION = 0.2
/**
 * A row that shares this many of a long fact's strong anchors (numbers,
 * identifiers, quoted text, mixed case) is a copy whatever the proportion:
 * one quoted sentence of a long fact names its specifics.
 */
export const MIN_STRONG_ANCHORS = 2

const LETTERS_OR_DIGITS = /[\p{L}\p{N}]/u
const QUOTED = /[`"“”]([^`"“”\n]{2,60})[`"“”]/gu

function stem(word) {
  if (word.length >= 7) return word.slice(0, 6)
  if (word.length >= 5 && word.endsWith("s")) return word.slice(0, -1)
  return word
}

export function trimToken(raw) {
  return raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
}

/**
 * Is this token specific enough to name a fact, and how specific? Strong:
 * numbers and dates, identifiers (`checkout_v3`, `src/app.js`, `eu-west-1`),
 * and mixed case (`PostgreSQL`). Weak: all capitals (`UTC`) and a capitalised
 * word that does not start a sentence (a name). A lowercase hyphenated word
 * ("short-lived") is ordinary English.
 *
 * @returns {"strong" | "weak" | null}
 */
function anchorTier(token, sentenceInitial) {
  const lower = token.toLowerCase()
  if (STOPWORDS.has(lower)) return null
  if (/\p{N}/u.test(token)) return token.length >= 2 ? "strong" : null
  if (/[\p{L}\p{N}][_./:@#$][\p{L}\p{N}]/u.test(token)) return "strong"
  if (/\p{Ll}/u.test(token) && /\p{Lu}/u.test(token.slice(1))) return "strong"
  if (/\p{Lu}/u.test(token.slice(1))) return "weak"
  return !sentenceInitial && /^\p{Lu}/u.test(token) ? "weak" : null
}

/**
 * The part of a stored row that is memory: a remember request without its
 * fixed prefix and reason, an echo without "Understood.", anything else whole.
 *
 * @param {unknown} content
 * @returns {{ kind: "wrapper" | "echo" | null, body: string, reason: string }}
 */
export function rememberParts(content) {
  const raw = String(content ?? "")
  const wrapper = raw.match(REMEMBER_WRAPPER)
  if (wrapper) {
    const rest = raw.slice(wrapper[0].length)
    const at = rest.indexOf(REASON_SEPARATOR)
    return at < 0
      ? { kind: "wrapper", body: rest.trim(), reason: "" }
      : { kind: "wrapper", body: rest.slice(0, at).trim(), reason: rest.slice(at + REASON_SEPARATOR.length).trim() }
  }
  if (REMEMBER_ECHO.test(raw)) return { kind: "echo", body: raw.replace(REMEMBER_ECHO, "").trim(), reason: "" }
  return { kind: null, body: raw.trim(), reason: "" }
}

/** True for a row recall drops as a remember request (src/recall.js). */
export function hiddenFromRecall(content) {
  return HIDDEN_FROM_RECALL.test(String(content ?? ""))
}

/**
 * The anchors (specific tokens; `strong` lists the strong ones, see
 * `anchorTier`) and stems (other content words) of a text. A word is counted
 * once: an anchor never also counts as a stem. Quoted text is a strong anchor.
 *
 * @param {unknown} text
 * @returns {{ anchors: string[], strong: string[], stems: string[], lower: string }}
 */
export function copyFeatures(text) {
  const source = String(text ?? "").slice(0, MAX_FORGOTTEN_CHARS)
  const anchors = new Set()
  const strong = new Set()
  const quotedWords = new Set()
  for (const match of source.matchAll(QUOTED)) {
    const phrase = match[1].trim().toLowerCase().replace(/\s+/g, " ")
    if (phrase.length < 2 || STOPWORDS.has(phrase) || !LETTERS_OR_DIGITS.test(phrase)) continue
    anchors.add(phrase)
    strong.add(phrase)
    for (const word of phrase.split(" ")) quotedWords.add(trimToken(word))
  }
  const stems = new Set()
  let sentenceInitial = true
  for (const raw of source.split(/\s+/)) {
    if (!raw) continue
    const initial = sentenceInitial
    sentenceInitial = /[.!?:]["'”)\]]*$/.test(raw)
    const token = trimToken(raw)
    if (token.length < 2) continue
    const lower = token.toLowerCase()
    if (quotedWords.has(lower)) continue
    const tier = anchorTier(token, initial)
    if (tier) {
      anchors.add(lower)
      if (tier === "strong") strong.add(lower)
      continue
    }
    for (const word of lower.match(/\p{L}{4,}/gu) ?? []) {
      if (!STOPWORDS.has(word)) stems.add(stem(word))
    }
  }
  const kept = [...anchors].slice(0, MAX_ANCHORS)
  return {
    anchors: kept,
    strong: kept.filter((anchor) => strong.has(anchor)),
    stems: [...stems].slice(0, MAX_STEMS),
    lower: source.toLowerCase(),
  }
}

/**
 * The features of a forgotten text without the text itself: what a later
 * forget matches a reported copy against (see `matchCopy`).
 */
export function featuresOnly(features) {
  return { anchors: features.anchors, strong: features.strong, stems: features.stems, lower: "" }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** True when `lower` contains `anchor` as a whole token (not inside a longer word or number). */
function containsToken(lower, anchor) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(anchor)}(?![\\p{L}\\p{N}])`, "u").test(lower)
}

/** The stems of every content word in a candidate row, anchors included. */
export function candidateStems(lower) {
  const stems = new Set()
  for (const word of lower.match(/\p{L}{4,}/gu) ?? []) if (!STOPWORDS.has(word)) stems.add(stem(word))
  return stems
}

/**
 * Is `text` a copy of one of the forgotten texts?
 *
 * - The forgotten text has strong anchors: one of them and a second shared
 *   signal (another anchor or a content word), or two weak anchors (two names).
 * - It has only weak anchors: one of them and a second shared signal.
 * - It has none (no number, identifier, or name): at least two shared content
 *   words, and 60% of its content words.
 *
 * A weak anchor and topical words are not enough when the fact has a strong
 * one: "export runs at 04:00 UTC" is not a copy of "export runs at 02:30 UTC".
 *
 * A fact with more than PROPORTIONAL_ABOVE features also needs a PROPORTION of
 * them shared, unless the row shares MIN_STRONG_ANCHORS of its strong anchors.
 * Only the first MAX_MATCH_CHARS characters of the row are read.
 *
 * @param {Array<ReturnType<typeof copyFeatures>>} forgotten
 * @param {unknown} text
 * @returns {null | { anchors: string[], stems: string[] }}
 */
export function matchCopy(forgotten, text) {
  const lower = String(text ?? "").slice(0, MAX_MATCH_CHARS).toLowerCase()
  if (!lower.trim()) return null
  const stems = candidateStems(lower)
  let best = null
  for (const features of forgotten) {
    const anchors = features.anchors.filter((anchor) => containsToken(lower, anchor))
    const strong = anchors.filter((anchor) => features.strong.includes(anchor)).length
    const weak = anchors.length - strong
    const shared = features.stems.filter((value) => stems.has(value))
    const signals = anchors.length + shared.length
    let copy
    if (features.strong.length > 0) copy = (strong >= 1 && signals >= 2) || weak >= 2
    else if (features.anchors.length > 0) copy = weak >= 1 && signals >= 2
    else copy = features.stems.length >= 2 && shared.length >= 2 && shared.length >= Math.ceil(0.6 * features.stems.length)
    const size = features.anchors.length + features.stems.length
    if (copy && size > PROPORTIONAL_ABOVE && signals < Math.ceil(PROPORTION * size) && strong < MIN_STRONG_ANCHORS) copy = false
    if (!copy) continue
    const strength = anchors.length * 2 + shared.length
    if (!best || strength > best.strength) best = { anchors, stems: shared, strength }
  }
  return best ? { anchors: best.anchors, stems: best.stems } : null
}

/**
 * Does `body` hold nothing but forgotten text? Every anchor of it appears in a
 * forgotten text; a body without anchors needs 80% of its content words there.
 * This decides whether the plugin's own remember row may be deleted with the
 * fact, so it errs towards "no": a row that also names something else is
 * reported, never deleted.
 *
 * @param {Array<ReturnType<typeof copyFeatures>>} forgotten
 * @param {unknown} body
 */
export function holdsNothingElse(forgotten, body) {
  const own = copyFeatures(body)
  if (own.anchors.length === 0 && own.stems.length === 0) return false
  if (own.anchors.length > 0) {
    return own.anchors.every((anchor) =>
      forgotten.some((features) => features.anchors.includes(anchor) || containsToken(features.lower, anchor)),
    )
  }
  const known = new Set(forgotten.flatMap((features) => [...features.stems, ...candidateStems(features.lower)]))
  const covered = own.stems.filter((value) => known.has(value)).length
  return covered >= Math.ceil(0.8 * own.stems.length)
}

/** True when the plugin wrote this row as a remember request (prefix and synthetic session). */
export function isRememberRequest(row) {
  return REMEMBER_WRAPPER.test(String(row?.content ?? "")) && REMEMBER_SESSION.test(String(row?.session_id ?? ""))
}

/** True when this row is the echo of a remember request: same synthetic session, same text. */
export function isRememberEcho(row, requests) {
  const content = String(row?.content ?? "")
  if (!REMEMBER_ECHO.test(content) || !REMEMBER_SESSION.test(String(row?.session_id ?? ""))) return false
  const body = rememberParts(content).body
  return requests.some((request) => request.session_id === row.session_id && rememberParts(request.content).body === body)
}

/** A one-line window of `text` around the first matched token. */
export function copyExcerpt(text, terms = [], max = 120) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim()
  if (clean.length <= max) return clean
  const lower = clean.toLowerCase()
  let hit = -1
  for (const term of terms) {
    const index = lower.indexOf(String(term).toLowerCase())
    if (index >= 0 && (hit < 0 || index < hit)) hit = index
  }
  const start = hit < 0 ? 0 : Math.max(0, Math.min(hit - Math.floor(max / 3), clean.length - max))
  const end = Math.min(clean.length, start + max)
  return `${start > 0 ? "…" : ""}${clean.slice(start, end).trim()}${end < clean.length ? "…" : ""}`
}

/**
 * Read one newest-first listing, page by page, reusing pages already read
 * (`pages` is shared by every pass over the same listing). Each page starts
 * where the rows so far end, so a backend that returns fewer rows than asked
 * costs a page, not a gap. The listing is complete at an empty page, or at a
 * short one unless the backend's `total` says more rows exist.
 *
 * It stops early when `stop()` is true after a page, before a page once
 * `deadline` has passed, at the first failed read, or after `maxPages`.
 *
 * @param {{
 *   pages: Map<number, { rows: any[], total?: number }>,
 *   readPage: (offset: number) => Promise<{ rows: any[], total?: number }>,
 *   pageSize: number,
 *   maxPages: number,
 *   deadline?: number,
 *   now?: () => number,
 *   onPage?: (rows: any[]) => void,
 *   stop?: () => boolean,
 * }} input
 * @returns {Promise<{ rows: any[], complete: boolean, truncated: boolean, timedOut: boolean, stopped: boolean, failed: string | null }>}
 */
export async function readListing({ pages, readPage, pageSize, maxPages, deadline = Infinity, now = Date.now, onPage, stop }) {
  const rows = []
  const end = (state) => ({ rows, complete: false, truncated: false, timedOut: false, stopped: false, failed: null, ...state })
  for (let page = 0; page < maxPages; page += 1) {
    let batch = pages.get(page)
    if (!batch) {
      if (now() > deadline) return end({ timedOut: true })
      try {
        const data = await readPage(rows.length)
        batch = { rows: Array.isArray(data?.rows) ? data.rows : [], total: Number.isFinite(Number(data?.total)) ? Number(data.total) : undefined }
      } catch (error) {
        return end({ failed: String(error?.message ?? error) })
      }
      pages.set(page, batch)
    }
    rows.push(...batch.rows)
    onPage?.(batch.rows)
    // A full page never ends the listing, whatever `total` says. A short page
    // does, unless the backend reports more rows than were read (it returned
    // fewer than asked).
    const complete =
      batch.rows.length === 0 ||
      (batch.rows.length < pageSize && (batch.total === undefined || rows.length >= batch.total))
    if (complete) return end({ complete: true })
    if (stop?.()) return end({ stopped: true })
  }
  return end({ truncated: true })
}
