/**
 * What may be stored, decided once for every write path (owner decision D3,
 * revised as D3' in 0.9.9).
 *
 * - **Secrets are refused everywhere**: API keys, tokens, private keys,
 *   passwords in assignments, connection strings with credentials.
 * - **A person's email address** is refused on an explicit write
 *   (`mem_remember`, `mem_revise`, `mem_page`, `mem_commitments`, records
 *   writes), as 0.9.5 refused it; **a home-directory path** is refused in a
 *   memory and stored with a warning on a page or a commitment
 *   (`EXPLICIT_POLICY`). An automatic write (turn capture, the host's
 *   compaction summary, the compaction checkpoint, routines) masks both.
 *
 * An explicit write that holds a secret is refused whole: the person or agent
 * can say it again without the value. An automatic write has no one to ask, so
 * each line that holds a secret is withheld (a private key block whole) and the
 * rest is kept, masked.
 *
 * The plugin (src/storable.js) and the records service (records/src/storable.js)
 * carry this file byte for byte: `npm run check:copies` fails on any drift. It
 * imports nothing, so either side can load it.
 */

/** The write paths and how each treats an email or a local path. */
export const STORABLE_PATHS = Object.freeze({
  remember: "explicit",
  page: "explicit",
  commitment: "explicit",
  import: "explicit",
  capture: "automatic",
  summary: "automatic",
  checkpoint: "automatic",
  routine: "automatic",
})

/**
 * What an explicit write does with a person's email address and a
 * home-directory path (owner decision D3', 0.9.9). Emails are refused on every
 * explicit write a person or agent makes, as 0.9.5 refused them in memories.
 * A role address (`support@`, `oncall@`, …) is a service, not a person: it is
 * refused in a memory and stored with a warning on a page or a commitment.
 * Paths are refused in memories, as in 0.9.5, and stored with a warning on a
 * page or a commitment, which 0.9.5 never checked. A collected event (import)
 * is the person's own source text: it keeps all of them, and a routine that
 * writes from it masks them.
 */
export const EXPLICIT_POLICY = Object.freeze({
  remember: Object.freeze({ email: "refuse", role: "refuse", path: "refuse" }),
  page: Object.freeze({ email: "refuse", role: "warn", path: "warn" }),
  commitment: Object.freeze({ email: "refuse", role: "warn", path: "warn" }),
  import: Object.freeze({ email: "warn", role: "warn", path: "warn" }),
})

/** The refusal messages of an explicit write, by reason; the agent relays them. */
export const REFUSALS = Object.freeze({
  email:
    "Nothing was stored: Memory doesn't store email addresses. An email address is personal data, not a durable fact. Keep the decision, and link the person's page (such as [[people/ama]]) instead of the address.",
  local_path: "not stored: an absolute local path is repo state, not a fact. It is wrong on every other machine.",
})

/** What an automatic write keeps in place of a line that held a secret. */
export const WITHHELD_SECRET = "[not stored: a credential]"
export const EMAIL_MASK = "<email>"

// ---------------------------------------------------------------------------
// Redaction for logs and ask excerpts (not storage). The local-path rules are
// shared with the derived core (opencode-mem-deploy build/core/memory-redact.ts)
// through test/fixtures/redaction-vectors.json, so keep their output stable.

const SECRET_PATTERNS = Object.freeze([
  // Authorization-style headers consume the whole value, including a scheme.
  [/\b(authorization|x-api-key)\b["']?(\s*[:=]\s*)[^\r\n,;]+/gi, "$1$2[redacted]"],
  // Token assignments, passwords, and API keys. The value may be quoted.
  [
    /\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret)\b["']?(\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi,
    "$1$2[redacted]",
  ],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{3,}/gi, "Bearer [redacted]"],
  [/\bsk-[A-Za-z0-9_-]{6,}/g, "[redacted-key]"],
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}\b/g, "[redacted-token]"],
])

/** Redact values that look like credentials. Used on every text this plugin logs or shows in an ask. */
export function redactSecrets(value) {
  let text = String(value ?? "")
  for (const [pattern, replacement] of SECRET_PATTERNS) text = text.replace(pattern, replacement)
  return text
}

// Absolute local paths: they name the user and the machine, and are wrong on
// every other one.
const PATH_SEGMENT = String.raw`[^\s/\\"'\x60<>|()\[\]{},;]+`
const LOCAL_PATHS = Object.freeze([
  // POSIX: home and machine-local roots, optionally as a file:// url.
  new RegExp(
    String.raw`(?<![\w.~/\\-])(?:file://)?/(?:Users|home|root|private|var|tmp|Volumes|mnt|media|srv)(?:/${PATH_SEGMENT})+/?`,
    "g",
  ),
  // The home directory as ~.
  new RegExp(String.raw`(?<![\w.~/\\-])~(?:/${PATH_SEGMENT})+/?`, "g"),
  // Windows: a drive or a UNC share, with \ or / (or JSON's \\) between parts.
  new RegExp(String.raw`(?<![\w.~/\\-])(?:[A-Za-z]:|\\\\${PATH_SEGMENT})(?:[\\/]+${PATH_SEGMENT})+[\\/]*`, "g"),
])

/** `<path>/<last part>`, or `<path>` when the last part is a user's name. */
function neutralPath(match) {
  const trail = /[.,:;!?]+$/.exec(match)?.[0] ?? ""
  const body = match.slice(0, match.length - trail.length).replace(/^file:\/\//, "")
  const parts = body.split(/[\\/]+/).filter(Boolean)
  const last = parts.at(-1)
  const before = parts.at(-2)
  const named = parts.length >= 2 && last && !/^(?:users|home)$/i.test(before ?? "") && !/^[A-Za-z]:$/.test(last)
  return `${named ? `<path>/${last}` : "<path>"}${trail}`
}

/**
 * Replace absolute local paths (macOS, Linux, Windows, `~`) with a neutral
 * placeholder that keeps the file name: a macOS home path to `app.ts` becomes
 * `<path>/app.ts`.
 */
export function redactLocalPaths(value) {
  let text = String(value ?? "")
  for (const pattern of LOCAL_PATHS) text = text.replace(pattern, neutralPath)
  return text
}

// ---------------------------------------------------------------------------
// Error text: what a failure may say. The plugin (src/util.js) and the records
// service (records/src/collector text, jobs.checkpoint) both redact a source's
// own words with this, so a secret never reaches an answer, a log or a store.
// It lives here, beside `redactSecrets`, because both sides carry this file.

/**
 * `scheme://userinfo@host`: a URL's userinfo is a credential, and Memory's own
 * patterns (storable.js) do not cover it.
 */
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]*@/gi
/** A whole URL: scheme, authority and path kept; the query string and fragment dropped. */
const ERROR_URL = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/?#]*)([^\s?#]*)(?:[?#][^\s]*)?/gi
/** A `Cookie:` or `Set-Cookie:` header: header name kept, value dropped. */
const ERROR_COOKIE = /\b((?:set-)?cookie\s*:\s*)[^\r\n]+/gi
/** A JWT: the shape Memory's own detector knows, masked whole rather than by part. */
const ERROR_JWT = /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g
/** A PEM private key block, whole. */
const ERROR_PEM = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g
/**
 * The backstop's candidate: one run of 24 or more word characters (letters,
 * digits, `_`, `-`, `+`, `/`, `=`) — the alphabet base64 secrets use, so an
 * AWS secret key with `/` and `+` stays one run. Paths and URLs are reduced
 * before this runs, so the `/` here is a secret's, not a directory's.
 */
const ERROR_LONG_TOKEN = /(?<![A-Za-z0-9_+/=-])[A-Za-z0-9_+/=-]{24,}(?![A-Za-z0-9_+/=-])/g
/** Characters of error text shown at most: enough for a cause, never a dump. */
export const ERROR_TEXT_MAX = 400

/** What an error says when showing its own text would risk a secret. */
export const ERROR_WITHHELD = "an error (details withheld: they may contain a secret)"

/**
 * A hex run of 32 or more characters: an SHA-256 digest or a hex-encoded key,
 * never something an error needs in full (owner decision, review F2 fourth
 * pass). Shorter hex — a 7 to 12 character commit hash or an id — stays
 * readable.
 */
const ERROR_HEX = /(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/g

/**
 * When a run of characters is a secret rather than a name (review F2, third
 * pass). Length alone cut hostnames and paths, so the rule is randomness:
 *
 * - **at least 24 characters** — a secret is long, and below that the entropy
 *   of a short random string is too close to prose's to judge;
 * - **mixed classes**: at least one lowercase, one uppercase and one digit, and
 *   **at least 20% lowercase**. Base64 secrets are lowercase-dominant or
 *   balanced; a record id (`rec_` + a ULID of uppercase and digits) is 13%
 *   lowercase, a hex hash and a UUID carry no uppercase at all, so each of
 *   those stays readable;
 * - **Shannon entropy at a length-aware cutoff: `min(4.5, log2(len) - 0.7)`
 *   bits per character** (the reviewer's rule, fourth pass). A string's
 *   entropy is capped at `log2(len)`, so a flat 4.5 missed 4% of 24-character
 *   tokens, 30% at 28 and 70% at 32; the length-aware line misses at most 5%
 *   and flags no new benign text. Measured: English words, file paths and
 *   sentences sit at 3.3–4.0 (a path with a digit, 3.9), a ULID-based record
 *   id at 4.3; random base62/base64 tokens sit at 4.2 (24 characters) to 5.0
 *   (32) and AWS secret keys at 4.7.
 *
 * Names can never cover every credential format; this rule covers the shapes
 * no name knows. Memory's own detector and patterns still run first, so a
 * named secret is caught even if this misses it.
 */
const MIXED_MIN_ENTROPY = 4.5
function randomToken(run) {
  const value = String(run ?? "")
  if (value.length < 24) return false
  // A short string cannot reach 4.5 bits per character: the ceiling is log2(len).
  const cutoff = Math.min(MIXED_MIN_ENTROPY, Math.log2(value.length) - 0.7)
  const lower = (value.match(/[a-z]/g) ?? []).length
  const upper = (value.match(/[A-Z]/g) ?? []).length
  if (lower === 0 || upper === 0 || !/\d/.test(value)) return false
  if (lower / value.length < 0.2) return false
  return entropyOf(value) >= cutoff
}

/** A URL's path, kept segment by segment: a part masked only when it alone is a secret by `randomToken`. */
function maskPath(path) {
  if (!path) return path
  const segments = path.split("/")
  // A secret may hold `/` itself (an AWS secret key), so the path's characters
  // are judged together first; only then is each segment judged alone.
  const joined = segments.join("")
  if (randomToken(joined)) return "/[redacted]"
  return segments.map((segment) => (randomToken(segment) ? "[redacted]" : segment)).join("/")
}

/** Shannon entropy, in bits per character. */
function entropyOf(text) {
  const counts = new Map()
  for (const char of text) counts.set(char, (counts.get(char) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) {
    const p = count / text.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/** A URL's authority with any userinfo masked, so `user:pass@host` keeps only the host. */
function maskAuthority(authority) {
  const at = authority.lastIndexOf("@")
  return at < 0 ? authority : `[redacted]@${authority.slice(at + 1)}`
}

/**
 * Text from a failure, safe to show in a tool answer or a console report
 * (0.10.3 gate A15; review F2). A plugin source's thrown value is third-party
 * data, so this is a sanitiser, not a formatter:
 *
 * 1. a PEM private key block becomes `[redacted-private-key]`, and a hex run
 *    of 32+ characters becomes `[redacted]` (a digest is no help in an error);
 * 2. every URL keeps its scheme, host and path — userinfo is masked and the
 *    query string and fragment are dropped, which covers a signed URL's
 *    signature and any `..._token=`, `key=` or `code=` parameter;
 * 3. a `Cookie:` or `Set-Cookie:` header's value becomes `[redacted]`;
 * 4. Memory's own secret patterns run (`redactSecrets`, src/storable.js);
 * 5. the backstop: a run of 24+ word characters that mixes letters and digits
 *    at random-token entropy becomes `[redacted]` — names cover only the
 *    formats someone thought of, and this is the rule for the rest.
 *
 * The result is capped at `ERROR_TEXT_MAX`. `errorMessage` then asks Memory's
 * own store detector (`secretKinds`) whether anything is still secret, and
 * withholds the whole message when it is.
 */
export function redactErrorText(value) {
  let text = String(value ?? "")
    .replace(ERROR_PEM, "[redacted-private-key]")
    .replace(ERROR_HEX, "[redacted]")
    .replace(ERROR_URL, (_match, scheme, authority, path) => `${scheme}${maskAuthority(authority)}${maskPath(path)}`)
  text = text.replace(ERROR_COOKIE, "$1[redacted]").replace(ERROR_JWT, "[redacted-jwt]")
  // Memory's patterns before the backstop: a JWT's three dot-separated parts
  // must match whole, which the backstop's runs would break apart.
  text = redactSecrets(text).replace(URL_USERINFO, "$1[redacted]@")
  text = text.replace(ERROR_LONG_TOKEN, (run) => (randomToken(run) ? "[redacted]" : run))
  return text.length > ERROR_TEXT_MAX ? `${text.slice(0, ERROR_TEXT_MAX - 1)}…` : text
}

// ---------------------------------------------------------------------------
// Detection for storage.

/** An email-shaped address: local part, then host. `emailKind` says whether it is a person's. */
const EMAIL = /(?<![\w.+-])([A-Za-z0-9._%+-]+)@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})(?![\w-])/g

/** Senders and system users: not a person (`git@`, `notifications@`, `ec2-user@…`, `deploy@…`). */
const NOT_PERSONAL_LOCAL =
  /^(?:git|hg|svn|no-?reply(?:[+._-].*)?|do-?not-?reply|notifications?|root|ubuntu|ec2-user|centos|debian|fedora|azureuser|opc|vagrant|ansible|deploy|deployer|jenkins|postgres|www-data)$/i
/** Hosts that are machines, not mailboxes: internal names, cloud instances, GitHub's no-reply users. */
const NOT_PERSONAL_HOST =
  /(?:^|\.)(?:internal|local|lan|localdomain|localhost)$|\.amazonaws\.com$|\.cloudapp\.azure\.com$|\.googleusercontent\.com$|(?:^|\.)noreply\.[a-z0-9.-]+$/i
/** An ssh, scp, sftp, rsync or mosh command on this line, with only options and paths between it and the address. */
const SSH_BEFORE = /\b(?:ssh|scp|sftp|rsync|mosh|ssh-copy-id)\s+(?:[-\w.\/~:=]+\s+)*$/i
/** A URL's userinfo: a user before the host, or a user and a password before it. */
const URL_USERINFO_BEFORE = /[a-z][a-z0-9+.-]*:\/\/(?:[^\s/@:]*:)?$/i
/** The scp and git remote form `user@host:path`. */
const REMOTE_AFTER = /^:(?:[/~.]|[\w.-]+\/)/
/** Role addresses: a service or a team, not a person. */
const ROLE_LOCAL = /^(?:support|security|oncall|ops|abuse|noc|help|info|admin|billing|privacy)$/i

/**
 * What an email-shaped match is: `person`, `role` (a fixed list: `support@`,
 * `oncall@`, …), or `none` (ssh and cloud user-at-host, URL userinfo, remote
 * `user@host:path`, service and no-reply senders).
 */
function emailKind(match, text) {
  const [whole, local, host] = match
  const before = text.slice(0, match.index)
  const lineBefore = before.slice(before.lastIndexOf("\n") + 1)
  if (URL_USERINFO_BEFORE.test(before)) return "none"
  if (SSH_BEFORE.test(lineBefore)) return "none"
  if (REMOTE_AFTER.test(text.slice(match.index + whole.length, match.index + whole.length + 40))) return "none"
  if (NOT_PERSONAL_LOCAL.test(local) || NOT_PERSONAL_HOST.test(host)) return "none"
  return ROLE_LOCAL.test(local) ? "role" : "person"
}

/**
 * A home directory: `/Users/<name>…`, `/home/<user>/…`, `~/…`, `C:\Users\…`.
 * Not `/var`, `/tmp`, `/srv`, `/mnt` or an API route: they name no person.
 */
const HOME_PATHS = Object.freeze([
  new RegExp(String.raw`(?<![\w.~/\\-])(?:file://)?/(?:Users(?:/${PATH_SEGMENT})+|home/${PATH_SEGMENT}(?:/${PATH_SEGMENT})+)/?`, "g"),
  new RegExp(String.raw`(?<![\w.~/\\-])~(?:/${PATH_SEGMENT})+/?`, "g"),
  new RegExp(String.raw`(?<![\w.~/\\-])[A-Za-z]:[\\/]+Users(?:[\\/]+${PATH_SEGMENT})+[\\/]*`, "gi"),
])

/** A private key block, from its BEGIN line to its END line (or the end of the text). */
const PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g

/** Well-known credential shapes, found anywhere. Each match is checked for documentation. */
const SHAPED = Object.freeze([
  // At a word start, with a key-like tail: 20 or more key characters, letters and digits.
  ["api key", /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{20,}/g, (match) => /\d/.test(match.slice(3)) && /[A-Za-z]/.test(match.slice(3))],
  ["api key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g],
  ["api key", /\bAIza[0-9A-Za-z_-]{30,}/g],
  ["api key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ["api key", /\b(?:AccountKey|SharedAccessKey)=[A-Za-z0-9+/]{20,}={0,2}/g],
  ["token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}/g],
  ["token", /\bgithub_pat_[A-Za-z0-9_]{20,}/g],
  ["token", /\bglpat-[A-Za-z0-9_-]{16,}/g],
  ["token", /\bxox[bpars]-[A-Za-z0-9-]{10,}/g],
  ["token", /\bnpm_[A-Za-z0-9]{30,}/g],
  ["token", /\bhf_[A-Za-z0-9]{30,}/g],
  ["token", /\bdop_v1_[A-Za-z0-9]{40,}/g],
  ["token", /https:\/\/hooks\.slack\.com\/(?:services|workflows|triggers)\/[A-Za-z0-9_/-]{20,}/g],
  ["token", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g],
])

/** `Bearer <token>`, `Authorization: <value>`, `x-api-key: <value>`. */
const BEARER = /\bBearer\s+([A-Za-z0-9._~+/=-]+)/gi
const AUTH_HEADER = /\b(?:authorization|x-api-key)\b["']?\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s,;]+(?:[ \t]+[^\s,;]+)?))/gi

/** `user:password@host` inside a URL; the password may itself hold `@`. */
const CONNECTION = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/]+):([^\s/]*)@[^\s@/]+/gi

const CREDENTIAL_KEYS =
  "api[_-]?key|apikey|access[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|passphrase|password|passwd|pwd|token|secret"

/**
 * An assignment of a credential: `password = hunter2`, `DB_PASSWORD="x"`,
 * `"api_key": "…"`, `password is: x`. The key may carry a prefix
 * (`OPENAI_API_KEY`), and the value may sit on the next line (pretty-printed
 * JSON, YAML). The value is checked by `credentialValue`, so prose
 * ("password: rotated quarterly", "token: 4096") and code
 * (`getToken(session)`) are not secrets.
 */
const ASSIGNMENT = new RegExp(
  String.raw`(?<![A-Za-z0-9])([A-Za-z0-9_.-]*?(${CREDENTIAL_KEYS}))["']?((?:[ \t]+(?:is|was))?[ \t]*[:=][ \t]*(?:\r?\n[ \t]*)?)(?:"([^"\n]*)"|'([^'\n]*)'|` + "`([^`\\n]*)`" + String.raw`|([^\s,;&]+))`,
  "gi",
)

const PLACEHOLDER =
  /^(?:\[[^\]]*\]|<[^>]*>|\{\{.*\}\}|\$\{?[A-Za-z_][\w.]*\}?|%[A-Za-z_]\w*%|\*+|x{3,}|\.{2,}|…|-+|true|false|null|nil|none|undefined|string|str|number|int|bool|required|optional|env|secret|password|token|redacted|placeholder|changeme|example|your[_-]?\w*|(?:process\.env|os\.environ|env)\b.*)$/i

/** The jwt.io sample token's payload and signature: documentation, not a credential. */
const JWT_IO_SAMPLE = /eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ|SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c/

/** Characters of a credential: no spaces, mostly token alphabet. */
const TOKENISH = /^[A-Za-z0-9._~+/=!@#$%^&*()\-:]+$/

/** A value or a token that is documentation: a placeholder, an example, a template. */
function documentation(value) {
  const v = String(value ?? "").trim()
  return (
    PLACEHOLDER.test(v) ||
    /example/i.test(v) ||
    /x{4,}/i.test(v) ||
    /<[^>]*>/.test(v) ||
    /\byour[-_][\w-]*here\b/i.test(v) ||
    /\$\{|\{\{/.test(v) ||
    JWT_IO_SAMPLE.test(v) ||
    /[…]|\.{3}$/.test(v)
  )
}

/** A value that is code, not a literal: a member access, a call, a path, an environment read. */
function codeValue(value) {
  const v = String(value ?? "").trim()
  return (
    // `session.accessToken`, `config.secretKey`: identifiers, not a random token with digits in it.
    (/^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+;?$/.test(v) && (v.match(/\d/g) ?? []).length <= 2) ||
    /^(?:await\s+)?[A-Za-z_$][\w$.]*\(/.test(v) ||
    /^(?:~|\.{1,2})?\/[\w./-]*$/.test(v) ||
    /^(?:process\.env|os\.environ|import\.meta\.env)\b/.test(v)
  )
}

/** Shannon entropy of a string, in bits per character. */
function entropy(value) {
  const counts = new Map()
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1)
  let bits = 0
  for (const count of counts.values()) {
    const p = count / value.length
    bits -= p * Math.log2(p)
  }
  return bits
}

/** A bare token: `min` or more token characters, a letter and a digit, not a word or a placeholder. */
function tokenShaped(value, min = 12) {
  const v = String(value ?? "").trim()
  return v.length >= min && TOKENISH.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v) && entropy(v) >= 3 && !documentation(v) && !codeValue(v)
}

/** Prose that a passphrase does not hold. */
const PROSE_WORDS = new Set(
  "a an the is are was were be been must should shall will can may not no never always every each at least most of to in on for and or with by from via see use uses used set stored managed rotated rotate required policy characters chars minimum maximum change changed expires expire reset same as one this that it its".split(" "),
)

/** `password: correct horse battery staple`: three to eight plain words, no prose, no full stop. */
function passphrase(rest) {
  const line = String(rest ?? "").trim()
  if (line.length < 16 || /[.!?]$/.test(line)) return false
  const words = line.split(/\s+/)
  return words.length >= 3 && words.length <= 8 && words.every((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word) && !PROSE_WORDS.has(word.toLowerCase()))
}

/**
 * Whether the value of a credential assignment is one. A quoted value counts
 * from 4 characters (8 for a token or secret); a bare one needs 6 (8) and a
 * digit, a symbol or an inner capital, which a word of prose does not have.
 * A value in a URL query (`?token=…&`) needs 16 characters and the entropy of
 * a random token.
 */
function credentialValue(value, quoted, key, query) {
  const v = String(value ?? "").trim()
  if (!v || documentation(v)) return false
  if (query) return tokenShaped(v, 16)
  const loose = /^(?:token|secret)$/i.test(key)
  if (quoted) return v.length >= (loose ? 8 : 4) && !/^\d+(?:\.\d+)?$/.test(v) && !/^[A-Za-z_$][\w$.]*\(|^\$\{/.test(v)
  if (codeValue(v) || !TOKENISH.test(v) || /^\d+(?:\.\d+)?$/.test(v)) return false
  if (v.length < (loose ? 8 : 6)) return false
  return /\d/.test(v) || /[^A-Za-z0-9]/.test(v) || /.[A-Z]/.test(v)
}

/** The kinds of secret in one piece of text: "private key", "api key", "token", "password", "connection string". */
export function secretKinds(text) {
  const value = String(text ?? "")
  const kinds = new Set()
  if (new RegExp(PRIVATE_KEY_BLOCK.source).test(value)) kinds.add("private key")
  for (const [kind, pattern, valid] of SHAPED) {
    for (const match of value.matchAll(pattern)) if (!documentation(match[0]) && (!valid || valid(match[0]))) kinds.add(kind)
  }
  for (const match of value.matchAll(BEARER)) if (tokenShaped(match[1])) kinds.add("token")
  for (const match of value.matchAll(AUTH_HEADER)) {
    const v = String(match[1] ?? match[2] ?? match[3] ?? "").trim().replace(/^(?:Bearer|Basic|Token|Bot)\s+/i, "")
    if (tokenShaped(v)) kinds.add("token")
  }
  for (const match of value.matchAll(CONNECTION)) if (match[2].length >= 3 && !documentation(match[2])) kinds.add("connection string")
  for (const match of value.matchAll(ASSIGNMENT)) {
    const key = match[2]
    const quoted = match[4] ?? match[5] ?? match[6]
    const bare = match[7]
    const crossed = /\n/.test(match[3])
    // A value on the next line that is itself a key ("DB_HOST=x", "host:") is not this key's value.
    if (crossed && bare !== undefined && /^[A-Za-z_][\w.-]*[:=]/.test(bare)) continue
    // In a URL query (`?token=…&page=2`) the value must look random.
    const query = /[?&]/.test(value[match.index - 1] ?? "")
    const password = /pass|pwd/i.test(key)
    let found = credentialValue(quoted ?? bare, quoted !== undefined, key, query)
    if (!found && password && quoted === undefined && !query) {
      const start = match.index + match[0].length - (bare ?? "").length
      const end = value.indexOf("\n", start)
      found = passphrase(value.slice(start, end === -1 ? value.length : end))
    }
    if (found) kinds.add(password ? "password" : /token/i.test(key) ? "token" : "api key")
  }
  return [...kinds]
}

/** The email addresses in the text, by kind: a person's, and role addresses. */
function emailCounts(text) {
  const value = String(text)
  const counts = { person: 0, role: 0 }
  for (const match of value.matchAll(EMAIL)) {
    const kind = emailKind(match, value)
    if (kind !== "none") counts[kind] += 1
  }
  return counts
}

function countPaths(text) {
  let n = 0
  for (const pattern of HOME_PATHS) n += (String(text).match(pattern) ?? []).length
  return n
}

/** Mask a person's emails and home-directory paths. */
function maskPersonal(text) {
  const value = String(text)
  let masked = ""
  let last = 0
  for (const match of value.matchAll(EMAIL)) {
    masked += value.slice(last, match.index) + (emailKind(match, value) === "none" ? match[0] : EMAIL_MASK)
    last = match.index + match[0].length
  }
  masked += value.slice(last)
  for (const pattern of HOME_PATHS) masked = masked.replace(pattern, neutralPath)
  return masked
}

/**
 * Withhold what holds a secret, in an automatic write: a private key block
 * whole, each line that holds one, and a key line together with the value
 * line after it ("password:" then the value). When a secret is still found
 * (it spans lines some other way), the whole text is withheld.
 */
function withholdSecrets(text) {
  let withheld = 0
  const blocks = String(text).replace(PRIVATE_KEY_BLOCK, () => {
    withheld += 1
    return WITHHELD_SECRET
  })
  const lines = blocks.split("\n")
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (line.trim() === WITHHELD_SECRET) continue
    if (secretKinds(line).length > 0) {
      lines[index] = WITHHELD_SECRET
      withheld += 1
      continue
    }
    // A key line and its value line: neither holds the secret alone, the two together do.
    const next = lines[index + 1]
    if (next !== undefined && next.trim() !== WITHHELD_SECRET && secretKinds(next).length === 0 && secretKinds(`${line}\n${next}`).length > 0) {
      lines.splice(index, 2, WITHHELD_SECRET)
      withheld += 1
    }
  }
  const kept = lines.join("\n")
  if (secretKinds(kept).length > 0) return { text: WITHHELD_SECRET, withheld: withheld + 1, whole: true }
  return { text: kept, withheld, whole: false }
}

/**
 * Decide what of `text` may be stored on write path `path`.
 *
 * - `refuse`: it holds a secret, or (an explicit write, by `EXPLICIT_POLICY`)
 *   a person's email address or a home-directory path. An explicit write
 *   stores nothing (`text` is ""; `reason` is secret, email or local_path);
 *   an automatic one keeps `text` with what holds the secret withheld (a line,
 *   a key line and its value line, or the whole text) and the rest masked.
 * - `warn`: an explicit write holding what its policy stores with a warning;
 *   `text` is unchanged and `message` is the warning to show.
 * - `mask`: an automatic write holding an email or a home-directory path;
 *   `text` has them masked.
 * - `store`: nothing to change.
 *
 * @param {unknown} text
 * @param {keyof typeof STORABLE_PATHS} path
 * @returns {{ outcome: "store"|"warn"|"mask"|"refuse", reason: ""|"secret"|"email"|"local_path", text: string, secrets: string[], emails: number, paths: number, withheld: number, message: string }}
 */
export function storable(text, path) {
  const mode = STORABLE_PATHS[path]
  if (!mode) throw new Error(`storable: unknown write path ${JSON.stringify(path)}`)
  const value = String(text ?? "")
  const secrets = secretKinds(value)
  if (mode === "explicit") {
    const counts = emailCounts(value)
    const emails = counts.person
    const roles = counts.role
    const paths = countPaths(value)
    if (secrets.length > 0) {
      return {
        outcome: "refuse",
        reason: "secret",
        text: "",
        secrets,
        emails,
        paths,
        withheld: 0,
        message: `not stored: the text holds a secret (${secrets.join(", ")}). Secrets are never stored; say it again without the value.`,
      }
    }
    const policy = EXPLICIT_POLICY[path]
    if ((emails > 0 && policy.email === "refuse") || (roles > 0 && policy.role === "refuse")) return { outcome: "refuse", reason: "email", text: "", secrets, emails: emails + roles, paths, withheld: 0, message: REFUSALS.email }
    if (paths > 0 && policy.path === "refuse") return { outcome: "refuse", reason: "local_path", text: "", secrets, emails, paths, withheld: 0, message: REFUSALS.local_path }
    if (emails + roles + paths > 0) {
      const what = [emails ? `${emails} email address${emails === 1 ? "" : "es"}` : "", roles ? `${roles} role email address${roles === 1 ? "" : "es"}` : "", paths ? `${paths} home-directory path${paths === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ")
      return {
        outcome: "warn",
        reason: "",
        text: value,
        secrets,
        emails: emails + roles,
        paths,
        withheld: 0,
        message: `Warning: stored with ${what}. Personal addresses and one machine's paths age badly; correct it without them if they are not needed.`,
      }
    }
    return { outcome: "store", reason: "", text: value, secrets, emails, paths, withheld: 0, message: "" }
  }
  const held = secrets.length > 0 ? withholdSecrets(value) : { text: value, withheld: 0, whole: false }
  const counts = emailCounts(held.text)
  const emails = counts.person + counts.role
  const paths = countPaths(held.text)
  const masked = emails + paths > 0 ? maskPersonal(held.text) : held.text
  const outcome = held.withheld > 0 ? "refuse" : emails + paths > 0 ? "mask" : "store"
  return {
    outcome,
    reason: held.withheld > 0 ? "secret" : "",
    text: masked,
    secrets,
    emails,
    paths,
    withheld: held.withheld,
    message: held.whole ? `the whole text withheld: it holds a secret (${secrets.join(", ")}) across lines` : held.withheld > 0 ? `${held.withheld} part(s) holding a secret (${secrets.join(", ")}) withheld` : "",
  }
}
