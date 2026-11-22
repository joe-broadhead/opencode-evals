/**
 * Forgotten-copy fingerprints (docs/design/adr-forget-copies.md, "Recall
 * withholds copies after a forget").
 *
 * A forget deletes a record but keeps the turns and atoms that copy its text
 * until the person consents to deleting each one. A fingerprint lets recall
 * withhold those copies from the person who forgot, in every later session.
 *
 * - The service extracts the features itself, from the forgotten text, with
 *   `copyFeatures` (`./copies.js`, a byte-for-byte copy of the plugin's
 *   `src/copies.js`; `npm run check:copies` fails when they differ). So a
 *   fingerprint holds only what `matchCopy` would match by, and stop-words,
 *   boilerplate or a caller's own terms cannot be stored. The text is not
 *   kept.
 * - Each anchor, stem and recorded copy id is hashed with HMAC-SHA256 under
 *   a random 256-bit key of one author in one space, cut to 128 bits. Only
 *   that author is given the key, with their own fingerprints.
 * - `pieces` (letter-or-digit runs of each token anchor) and `phrases` (the
 *   length of each other anchor, a quoted phrase) let a matcher hash only the
 *   spans that could equal an anchor.
 * - A fingerprint never lifts itself: deleting the copies the forget found
 *   does not end it, because a copy can be written after the forget (its own
 *   reply quotes the turns). Only the person lifts one, in Memory's console,
 *   in a browser session (`forgotten.lift` refuses every bearer credential).
 */
import { createHmac, randomBytes } from "node:crypto"
import { MAX_MATCH_CHARS, MIN_STRONG_ANCHORS, PROPORTION, PROPORTIONAL_ABOVE, candidateStems, copyFeatures } from "./copies.js"

/** The feature rules a fingerprint was made with; a matcher refuses others. */
export const FEATURE_VERSION = 1
/** The forgotten text read, as `mem_remember` caps a memory. */
export const MAX_TEXT_CHARS = 4_000
/**
 * Fingerprints one author keeps in a space. Equal fingerprints (one feature
 * set) are stored once. There is no cap per space: a fingerprint is its
 * author's, so one author's cannot crowd out another's.
 */
export const MAX_PER_AUTHOR = 2_000
/** What was forgotten: a memory of one of these types, or a core atom. */
export const FORGOTTEN_KINDS = Object.freeze(["fact", "decision", "constraint", "preference", "procedure", "atom"])
/** Bytes of each hash kept (128 bits), as unpadded base64url. */
const HASH_BYTES = 16

export const FORGOTTEN_ID = /^fp_[0-9A-HJKMNP-TV-Z]{26}$/

const PIECE = /[\p{L}\p{N}]+/gu
const ALNUM_START = /^[\p{L}\p{N}]/u
const ALNUM_END = /[\p{L}\p{N}]$/u

/** A new key for one author in one space: 32 random bytes, base64url. */
export function newForgottenKey() {
  return randomBytes(32).toString("base64url")
}

/** The keyed hash of one feature (an anchor or a stem, as copyFeatures gives it). */
export function hashTerm(key, term) {
  return createHmac("sha256", Buffer.from(String(key), "base64url")).update(String(term), "utf8").digest().subarray(0, HASH_BYTES).toString("base64url")
}

/**
 * An anchor a matcher finds by letter-or-digit runs: no whitespace, and a
 * letter or digit at each end. Anything else (a quoted phrase) is found by
 * its length.
 */
export function isTokenAnchor(anchor) {
  return !/\s/.test(anchor) && ALNUM_START.test(anchor) && ALNUM_END.test(anchor)
}

/** Letter-or-digit runs in an anchor. */
export function pieceCount(anchor) {
  return (String(anchor).match(PIECE) ?? []).length
}

/**
 * The fingerprint of a forgotten text, or null when `matchCopy` could never
 * call anything a copy of it: it needs two features (two anchors, an anchor
 * and a stem, or two stems), and stop-words and boilerplate are none.
 *
 * @param {string} key
 * @param {string} text
 */
export function fingerprintOf(key, text) {
  const features = copyFeatures(text)
  if (features.anchors.length + features.stems.length < 2) return null
  const unique = (values) => [...new Set(values)]
  const tokens = features.anchors.filter(isTokenAnchor)
  return {
    v: FEATURE_VERSION,
    anchors: unique(features.anchors.map((anchor) => hashTerm(key, anchor))).sort(),
    strong: unique(features.strong.map((anchor) => hashTerm(key, anchor))).sort(),
    stems: unique(features.stems.map((stem) => hashTerm(key, stem))).sort(),
    pieces: unique(tokens.map(pieceCount)).sort((a, b) => a - b),
    phrases: unique(features.anchors.filter((anchor) => !isTokenAnchor(anchor)).map((anchor) => anchor.length)).sort((a, b) => a - b),
  }
}

// ---------------------------------------------------------------------------
// The service's own matcher, for the routines (FABLE records #2): a routine
// write that copies text someone in the space forgot is skipped. It is the
// plugin's `createForgottenMatcher` (src/forgotten.js) over every author's
// fingerprints, each hashed with its author's key; test/forgotten-parity.test.js
// holds the two equal.

function codeBefore(text, index) {
  if (index <= 0) return ""
  const low = text.charCodeAt(index - 1)
  if (index >= 2 && low >= 0xdc00 && low <= 0xdfff) {
    const high = text.charCodeAt(index - 2)
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index)
  }
  return text[index - 1]
}

function codeAt(text, index) {
  if (index >= text.length) return ""
  return String.fromCodePoint(text.codePointAt(index))
}

const ALNUM = /[\p{L}\p{N}]/u
const SPACE = /\s/

/**
 * A matcher over one author's fingerprints, as stored: `{key, fingerprints}`.
 * `matches(text)` answers the ids of the fingerprints `text` copies.
 *
 * @param {string | null} key
 * @param {Array<{id: string, v?: number, anchors?: string[], strong?: string[], stems?: string[], pieces?: number[], phrases?: number[]}>} fingerprints
 */
export function authorMatcher(key, fingerprints) {
  const known = (Array.isArray(fingerprints) ? fingerprints : []).filter((fp) => fp && Number(fp.v) === FEATURE_VERSION && Array.isArray(fp.anchors) && Array.isArray(fp.stems))
  const prints = known.map((fp) => ({ id: fp.id, anchors: new Set(fp.anchors), strong: new Set(Array.isArray(fp.strong) ? fp.strong : []), stems: new Set(fp.stems) }))
  const numbers = (field) => [...new Set(known.flatMap((fp) => (Array.isArray(fp[field]) ? fp[field] : [])).map(Number).filter((n) => Number.isInteger(n) && n >= 1))]
  const pieces = numbers("pieces")
  const phrases = numbers("phrases")
  const memo = new Map()
  const hashed = (term) => {
    let value = memo.get(term)
    if (value === undefined) {
      value = hashTerm(key, term)
      if (memo.size < 100_000) memo.set(term, value)
    }
    return value
  }
  function spanHashes(lower) {
    const spans = new Set()
    if (pieces.length > 0) {
      const runs = [...lower.matchAll(PIECE)].map((found) => ({ start: found.index, end: found.index + found[0].length }))
      for (let i = 0; i < runs.length; i += 1) {
        for (const n of pieces) {
          const last = runs[i + n - 1]
          if (!last) continue
          const span = lower.slice(runs[i].start, last.end)
          if (n > 1 && SPACE.test(span)) continue
          spans.add(hashed(span))
        }
      }
    }
    if (phrases.length > 0) {
      for (let p = 0; p < lower.length; p += 1) {
        const code = lower.charCodeAt(p)
        if (code >= 0xdc00 && code <= 0xdfff) continue
        if (ALNUM.test(codeBefore(lower, p))) continue
        for (const length of phrases) {
          const end = p + length
          if (end > lower.length || ALNUM.test(codeAt(lower, end))) continue
          spans.add(hashed(lower.slice(p, end)))
        }
      }
    }
    return spans
  }
  function matches(text) {
    if (!key || prints.length === 0) return []
    const lower = String(text ?? "").slice(0, MAX_MATCH_CHARS).toLowerCase()
    if (!lower.trim()) return []
    const spans = spanHashes(lower)
    const stems = new Set([...candidateStems(lower)].map(hashed))
    const found = []
    for (const fp of prints) {
      let anchors = 0
      let strong = 0
      for (const hash of fp.anchors) {
        if (!spans.has(hash)) continue
        anchors += 1
        if (fp.strong.has(hash)) strong += 1
      }
      const weak = anchors - strong
      let shared = 0
      for (const hash of fp.stems) if (stems.has(hash)) shared += 1
      const signals = anchors + shared
      let copy
      if (fp.strong.size > 0) copy = (strong >= 1 && signals >= 2) || weak >= 2
      else if (fp.anchors.size > 0) copy = weak >= 1 && signals >= 2
      else copy = fp.stems.size >= 2 && shared >= 2 && shared >= Math.ceil(0.6 * fp.stems.size)
      const size = fp.anchors.size + fp.stems.size
      if (copy && size > PROPORTIONAL_ABOVE && signals < Math.ceil(PROPORTION * size) && strong < MIN_STRONG_ANCHORS) copy = false
      if (copy) found.push(fp.id)
    }
    return found
  }
  return { size: prints.length, matches }
}

/**
 * One matcher over several authors' fingerprints: a text is a copy when it
 * copies any author's. `authors` is `[{key, fingerprints}]`.
 */
export function spaceMatcher(authors) {
  const each = (authors ?? []).map((a) => authorMatcher(a.key, a.fingerprints)).filter((m) => m.size > 0)
  return {
    size: each.reduce((n, m) => n + m.size, 0),
    matches: (text) => each.flatMap((m) => m.matches(text)),
  }
}

// ---------------------------------------------------------------------------
// Text tombstones (the routine-safety review, item 3): what the service keeps
// itself at forget time, so a verbatim mention is never written back by a
// routine even when the client's fingerprint is missing (its write failed, or
// the author is at the cap). Sentences of three to 40 words, normalised
// (letters and digits, lower case), each hashed with the space's key; a text
// copies one when any run of its words equals it.

export const TEXT_MIN_WORDS = 3
export const TEXT_MAX_WORDS = 40

/** The words of a text as a tombstone compares them. */
export function normalWords(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
}

/**
 * The sentences of a forgotten text, normalised: split at sentence ends, line
 * breaks and quotation marks (so an "Evidence: “…”" quote is its own), each
 * cut to TEXT_MAX_WORDS words; shorter than TEXT_MIN_WORDS are left out.
 *
 * @returns {string[][]}
 */
export function tombstoneSentences(text) {
  const out = []
  for (const piece of String(text ?? "").slice(0, MAX_TEXT_CHARS).split(/[.!?;\n]+(?=\s|$)|\n+|["“”«»]/u)) {
    const words = normalWords(piece).slice(0, TEXT_MAX_WORDS)
    if (words.length >= TEXT_MIN_WORDS) out.push(words)
  }
  return out
}

/** The keyed hash of a run of words. */
export function textHash(key, words) {
  return hashTerm(key, words.join(" "))
}

const SCAFFOLD_ABOUT = /^\s*(?:about|why it waits)\s*:/i
const SCAFFOLD_WHY = /^\s*why\s*:\s*/i
const SCAFFOLD_EVIDENCE = /^\s*evidence\s*:/i
const REMEMBER_PREFIX = /^\s*please remember this (?:fact|decision|constraint|preference|procedure) for later:\s*/i
const MARKUP = /\[\[[^\]]*\]\]|\[(?:turn|event|record)\s[^\]]*\]/gi

/** True when one normalised word list is the other, or holds it as a run, or shares 80% of the shorter's words. */
function sameContent(a, b) {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a]
  if (short.length === 0) return false
  const text = ` ${long.join(" ")} `
  if (text.includes(` ${short.join(" ")} `)) return true
  const set = new Set(long)
  return short.filter((w) => set.has(w)).length / short.length >= 0.8
}

// ---------------------------------------------------------------------------
// Outbox purge entries (0.9.8 slice 6a, docs/design/forget-erase.md): what a
// client needs to delete forgotten text from its own spool and quarantine,
// without the text and without a long-lived key. Each forget writes one entry
// for its caller: the sentences of what it erased, normalised as
// `normalWords`, each hashed with `textHash` under a salt of that entry alone.
// `forgotten.match` gives a caller their own entries younger than the window,
// and the entry (salt included) is deleted when the window ends.

/** The purge contract's version (`forgotten.match` answers it). */
export const PURGE_VERSION = 1
/**
 * Days a purge entry is kept: the longest a client holds a turn, 7 days
 * pending (src/spool.js MAX_AGE_MS) and then 14 quarantined (QUARANTINE_TTL_MS).
 */
export const PURGE_WINDOW_DAYS = 21
/** Hashes one entry keeps; a longer forget keeps its first sentences. */
export const MAX_PURGE_HASHES = 2_000
export const PURGE_ID = /^pg_[0-9A-HJKMNP-TV-Z]{26}$/

/**
 * An entry's salt: derived from the service's forget secret when one is set,
 * so it is never in the space file; otherwise random, and stored with the
 * entry until the entry expires.
 *
 * @param {string} secret the service's forget secret, or "" for none
 */
export function purgeSalt(secret, spaceId, id) {
  if (!secret) return newForgottenKey()
  return createHmac("sha256", secret).update(`opencode-mem purge v${PURGE_VERSION}\0${spaceId}\0${id}`, "utf8").digest().toString("base64url")
}

/**
 * The key of a space's text tombstones when the service has a forget secret:
 * derived from it, so it is never in the space file, and a person with only
 * the file cannot confirm a guess at a forgotten sentence (FABLE privacy
 * review of 6a). Without a secret the key is random and stored in the file's
 * meta (`forget_text_key`), as before 0.9.8.
 *
 * @param {string} secret the service's forget secret (32 bytes or more)
 * @param {string} spaceId
 */
export function textTombstoneKey(secret, spaceId) {
  return createHmac("sha256", secret).update(`opencode-mem text tombstone v1\0${spaceId}`, "utf8").digest().toString("base64url")
}

/** Bytes a forget secret needs: the HMAC key of the purge salts and text tombstones. */
export const FORGET_SECRET_MIN_BYTES = 32

/**
 * The hashes of a purge entry: each sentence's normalised words under the
 * salt, unique, at most MAX_PURGE_HASHES, and the word counts a matcher needs.
 *
 * @param {string} salt
 * @param {string[][]} sentences normalised word lists (substantiveSentences)
 */
export function purgeHashes(salt, sentences) {
  const hashes = new Set()
  const lengths = new Set()
  for (const words of sentences) {
    if (hashes.size >= MAX_PURGE_HASHES) break
    const before = hashes.size
    hashes.add(textHash(salt, words))
    if (hashes.size > before) lengths.add(words.length)
  }
  return { hashes: [...hashes].sort(), lengths: [...lengths].sort((a, b) => a - b) }
}

/**
 * The client's side of the purge contract, here for the tests and as its
 * reference: a text matches an entry when any run of its normalised words,
 * of one of the entry's lengths, hashes under the entry's salt to one of its
 * hashes. `matches(text)` answers the ids of the entries it matches.
 *
 * @param {Array<{id: string, salt: string, lengths: number[], hashes: string[]}>} entries
 */
export function purgeMatcher(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.salt === "string" && Array.isArray(e.hashes) && Array.isArray(e.lengths))
  const prepared = list.map((e) => ({ id: e.id, salt: e.salt, lengths: e.lengths.map(Number).filter((n) => Number.isInteger(n) && n >= 1), hashes: new Set(e.hashes) }))
  return {
    size: prepared.length,
    matches(text) {
      const words = normalWords(text)
      const found = []
      for (const entry of prepared) {
        let hit = false
        for (const n of entry.lengths) {
          for (let i = 0; i + n <= words.length && !hit; i += 1) hit = entry.hashes.has(textHash(entry.salt, words.slice(i, i + n)))
          if (hit) break
        }
        if (hit) found.push(entry.id)
      }
      return found
    },
  }
}

/**
 * The substantive sentences of a forgotten memory or commitment (the
 * re-check's item 1): its title or `what`, and the sentences of its body, with
 * the scaffolding the routines and the plugin add taken out: `About:` and
 * `Why it waits:` lines, links (`[[…]]`) and citations (`[turn …]`), the
 * `Why:` prefix, and the remember wrapper. The quoted `Evidence:` counts only
 * when it is the forgotten content itself (the title's own words), not the
 * context a paraphrase was read from. Hashing the scaffolding blocked every
 * later record that shared "About: [[projects/harbour]]".
 *
 * @param {{title?: any, body?: any, what?: any}} record
 * @returns {string[][]} normalised word lists
 */
export function substantiveSentences({ title, body, what }) {
  const mains = [title, what].map((t) => String(t ?? "").replace(REMEMBER_PREFIX, "").replace(MARKUP, " ")).filter((t) => t.trim())
  const out = mains.flatMap((t) => tombstoneSentences(t))
  const mainWords = mains.map((t) => normalWords(t))
  for (const raw of String(body ?? "").replace(REMEMBER_PREFIX, "").split(/\r?\n/)) {
    if (!raw.trim() || SCAFFOLD_ABOUT.test(raw)) continue
    if (SCAFFOLD_EVIDENCE.test(raw)) {
      const quote = /[“"«]([^”"»]+)[”"»]/u.exec(raw)?.[1] ?? ""
      const words = normalWords(quote)
      if (words.length >= TEXT_MIN_WORDS && mainWords.some((m) => sameContent(m, words))) out.push(...tombstoneSentences(quote))
      continue
    }
    const line = raw.replace(SCAFFOLD_WHY, "").replace(MARKUP, " ")
    if (!/[\p{L}\p{N}]/u.test(line)) continue
    out.push(...tombstoneSentences(line))
  }
  return out
}
