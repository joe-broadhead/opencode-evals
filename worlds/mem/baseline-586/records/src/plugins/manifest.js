/**
 * The fixed frame of plugin-declared Memory (DESIGN-PLUGIN-MEMORY §1.2, §5.6,
 * and DESIGN-MEMORY-JOBS §9 for schema v2): the `memory-plugin.v2` schema of a
 * plugin's `package.json#memory`, the read-verb allowlist with the write-verb
 * check on every token, the connector's identity, reads and scope inputs, its
 * templates, and the canonical digest (RFC 8785 JSON, SHA-256).
 *
 * One module, three copies kept identical by scripts/check-copies.mjs:
 * records/src/plugins/manifest.js for the records service, which validates
 * every report again, and src/plugins/manifest.js for the plugin's discovery.
 * Its only import is the shape guard, which sits beside both copies.
 *
 * Nothing here names a plugin or a source. A manifest that fails anywhere is
 * invalid as a whole: `validateManifest` answers the first reason, and
 * nothing in it is used. Plugin text is data: it is length-limited and
 * shape-checked here, and never enters a prompt, a tool description, a skill
 * or the protocol.
 */
import { createHash } from "node:crypto"
import { shapes } from "../shapes.js"

/** The schema's major version. Memory accepts this one and the one before it (v1's `sources` + `routines`). */
export const SCHEMA_VERSION = 2
export const SCHEMA_VERSIONS = Object.freeze([1, 2])
/** The `events_list` contract a declared source must speak (§9.3). */
export const SOURCE_CONTRACT = 2
/**
 * The event fields a `perUnit` scope input may take its value from (§9.1 C).
 * `thread` is written `<scheme>-thread:<channel id>:<thread ts>`, so its channel
 * and its ts are the two parts of it, never anything parsed from an event's text.
 */
export const PER_UNIT_FIELDS = Object.freeze(["external_id", "thread_channel", "thread_ts"])

/** The allowed verbs (§9.1 A). `fetch` is not one: it can send data out. */
export const READ_VERBS = Object.freeze(["read", "get", "list", "search", "lookup", "view", "describe", "history", "query", "count"])
/**
 * The write verbs (§5.6): no token of a tail or op may be one of these.
 *
 * The name check cannot prove a tool is read-only: a tool named `get_x` may
 * write. It refuses the obvious names; the real defences are that a binding's
 * session allows exactly the grants the person confirmed (src/plugins/grants.js)
 * and the plugin kit's recorded-assertion check, which fails a plugin's CI on
 * any action its events_list asserts that its declaration does not list.
 */
export const WRITE_VERBS = Object.freeze([
  "send", "post", "reply", "set", "add", "edit", "create", "update", "upsert", "delete", "remove", "trash", "modify", "patch", "insert",
  "import", "export", "write", "put", "save", "publish", "share", "invite", "upload", "schedule", "react", "mark", "label", "pin",
  "follow", "archive", "move", "merge", "close", "comment", "assign", "draft", "approve", "submit", "cancel", "revoke", "grant", "run",
  "execute", "invoke", "purge", "destroy", "drop", "wipe", "erase", "transfer", "trigger", "kick",
  "join", "leave", "ban", "mute", "toggle", "forward", "dispatch", "clear", "flush", "reset", "truncate", "overwrite", "apply",
])
/** Tokens that join two actions in one name (`read_and_delete`): refused whatever the verbs. */
export const CONJUNCTIONS = Object.freeze(["and", "then", "or"])
/** The deepest a declaration may nest (the schema needs 6), and the deepest canonical JSON goes. */
export const MAX_DEPTH = 12
const MAX_CANONICAL_DEPTH = 64
/** Namespaces no plugin may claim: Memory's own, the host's, and OpenCode's builtin tool ids. */
export const RESERVED_NAMESPACES = Object.freeze([
  "mem", "opencode", "jobs", "execute", "codemode",
  "bash", "read", "write", "edit", "glob", "grep", "list", "patch", "task", "todowrite", "todoread", "webfetch", "websearch", "skill", "question", "lsp", "shell", "plan", "build",
])
/** The event kinds of the `events_list` contract, with v2's `snapshot` (§1.4). */
export const EVENT_KINDS = Object.freeze(["message", "meeting", "session", "bookmark", "issue", "pr", "commit", "doc", "event", "snapshot"])
/** The `render` engine's placeholders (§4.3), and only these. */
export const RENDER_PLACEHOLDERS = Object.freeze(["title", "count", "participants", "first_at", "last_at", "cite", "url", "text"])
/** The output kinds (§4.5). `section:<Heading>` is written with its heading. */
export const PROPOSAL_OUTPUTS = Object.freeze(["decision", "fact", "commitment_open", "commitment_close", "procedure", "person", "link"])

export const MAX_SOURCES = 8
export const MAX_ROUTINES = 16
export const MAX_READS = 16
export const MAX_TEMPLATES = 8
export const MAX_GRANTS = 8
export const MAX_SCOPE_KEYS = 8
export const MAX_INPUT_BYTES = 512
export const MAX_HINTS = 1500
export const MAX_RENDER_ITEMS = 50
export const MAX_TOKENS_PER_RUN = 25_000

const ID = /^[a-z][a-z0-9-]{0,39}$/
const NAMESPACE = /^[a-z][a-z0-9-]{0,31}$/
const LABEL = /^[a-z][a-z0-9_.:-]{0,63}$/
const LABEL_PREFIX = /^[a-z][a-z0-9_-]{0,31}$/
const METRIC = /^[a-z][a-z0-9_]{0,23}$/
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/
const WINDOWS = ["1d", "7d", "31d"]
/** A host a templated `{url}` may point at: a domain, or `*.` and a domain. */
const HOST_PATTERN = /^(?:\*\.)?[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
/**
 * The multi-label public suffixes a person can register under but not *be*: a
 * pattern of one of these names no site of theirs. A small embedded list, the
 * common ones; a suffix it misses is caught by the registrable-domain rule.
 */
const PUBLIC_SUFFIXES = new Set([
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "net.uk", "sch.uk", "ltd.uk", "plc.uk",
  "com.au", "net.au", "org.au", "edu.au", "gov.au", "co.nz", "net.nz", "org.nz", "govt.nz",
  "co.jp", "ne.jp", "or.jp", "go.jp", "co.kr", "or.kr", "co.in", "net.in", "org.in", "co.za",
  "com.br", "net.br", "org.br", "com.mx", "com.ar", "com.co", "com.pe", "com.ve", "com.uy",
  "com.tr", "com.cn", "com.tw", "com.hk", "com.sg", "com.my", "com.ph", "com.vn", "com.pk",
  "com.ng", "com.sa", "com.eg", "com.ua", "com.pl", "com.es", "com.gr", "com.pt", "com.ro",
  "co.id", "co.il", "co.ke", "co.th", "co.ae", "co.ma", "co.bw", "co.zw", "co.tz", "co.ug",
])
/** Hosts anyone can claim, or that hand a page to the next stranger: no evidence of the source. */
const SHARED_HOSTS = new Set([
  "cloudfront.net", "amazonaws.com", "storage.googleapis.com", "blob.core.windows.net", "web.core.windows.net",
  "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "github.io", "githubusercontent.com",
  "gitlab.io", "bitbucket.io", "appspot.com", "firebaseapp.com", "web.app", "azurewebsites.net", "elasticbeanstalk.com",
  "onrender.com", "railway.app", "fly.dev", "deno.dev", "glitch.me", "repl.co", "surge.sh", "ngrok.io", "r2.dev",
  "blogspot.com", "wordpress.com", "wixsite.com", "translate.goog", "ipfs.io", "dweb.link", "bit.ly", "tinyurl.com",
])
/** Measurement and advertising: a collected link to one of these is a beacon, not a source. */
const TRACKER_HOSTS = new Set([
  "doubleclick.net", "google-analytics.com", "googletagmanager.com", "googleadservices.com", "googlesyndication.com",
  "2mdn.net", "facebook.net", "scorecardresearch.com", "criteo.com", "taboola.com", "outbrain.com", "adnxs.com",
  "hotjar.com", "segment.io", "mixpanel.com", "amplitude.com", "quantserve.com", "moatads.com", "adsrvr.org",
  "casalemedia.com", "rubiconproject.com", "pubmatic.com", "openx.net", "clarity.ms", "branch.io", "appsflyer.com",
  "adjust.com", "kochava.com", "smartadserver.com", "teads.tv", "yieldmo.com", "bat.bing.com",
])

/**
 * The second-level labels a ccTLD hands out as registry rules (`com.de`,
 * `gov.in`, `co.uk`): a pattern of one of these plus a two-letter country code
 * names no site, and so does a wildcard on it. The embedded suffix list names
 * the common ones; this rule is what catches one it misses.
 */
const EFFECTIVE_SLD = new Set([
  "com", "co", "gov", "org", "net", "ac", "edu", "ne", "or", "go", "nic", "mil", "sch", "ltd", "plc",
  "gen", "web", "biz", "info", "nom", "res", "idv", "gob", "gouv", "gv", "k12", "muni",
])

/** True when a two-label host is an effective-TLD rule: `<second level>.<ccTLD>`. */
function isEffectiveSldRule(labels) {
  return labels.length === 2 && EFFECTIVE_SLD.has(labels[0]) && /^[a-z]{2}$/.test(labels[1])
}

/** The multi-label public suffix a host ends in, or null. */
function publicSuffixOf(labels) {
  for (const size of [3, 2]) {
    if (labels.length > size && PUBLIC_SUFFIXES.has(labels.slice(-size).join("."))) return labels.slice(-size).join(".")
  }
  return null
}

/**
 * Why a `urlHosts` pattern is too broad to mean anything, or null: a public
 * suffix alone, a wildcard sitting on one, no registrable domain under a
 * wildcard, a shared host, or a tracker.
 */
export function urlHostProblem(host) {
  if (typeof host !== "string" || !HOST_PATTERN.test(host)) return "is not a host pattern (a domain such as slack.com, or *.slack.com)"
  const bare = host.toLowerCase().replace(/^\*\./, "")
  const labels = bare.split(".")
  if (labels.length < 2) return "names no registrable domain (a host needs at least two labels)"
  // §9.4: a label in punycode (`xn--…`) hides what the host actually is — another
  // script, or a lookalike of the source's own name — so no pattern may carry one.
  if (labels.some((label) => label.startsWith("xn--"))) return "is a punycode host (a label starting xn--), which hides what it is"
  const suffix = publicSuffixOf(labels)
  if (PUBLIC_SUFFIXES.has(bare)) return `is a public suffix (${bare}), which names no site`
  if (isEffectiveSldRule(labels)) return `is an effective-TLD rule (${bare}), which names no site`
  if (suffix && bare === suffix) return `is a public suffix (${suffix}), which names no site`
  for (const listed of SHARED_HOSTS) if (bare === listed || bare.endsWith(`.${listed}`)) return `is a shared host (${listed}), which anyone can claim`
  for (const listed of TRACKER_HOSTS) if (bare === listed || bare.endsWith(`.${listed}`)) return `is a tracker (${listed}), which is no source's destination`
  return null
}
const CADENCES = ["daily", "weekly", "monthly"]
const ENGINES = ["render", "extract"]
const UNITS = ["event", "thread"]

class Invalid extends Error {}

/**
 * A plugin-supplied name, as a reason may echo it: letters, digits, _, . and
 * - only, at most 40 characters, else a fixed word. Reasons are shown in the
 * console and reach the records service; they never carry plugin text.
 */
function echo(name) {
  const value = String(name ?? "")
  return /^[A-Za-z0-9_.-]{1,40}$/.test(value) ? value : "(a name that is not shown)"
}

/** True when a JSON value nests deeper than `max` (arrays and objects), checked without recursion. */
function deeperThan(value, max) {
  const stack = [[value, 0]]
  while (stack.length) {
    const [item, depth] = stack.pop()
    if (item === null || typeof item !== "object") continue
    if (depth >= max) return true
    for (const child of Array.isArray(item) ? item : Object.values(item)) if (child !== null && typeof child === "object") stack.push([child, depth + 1])
  }
  return false
}

function fail(message) {
  throw new Invalid(message)
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function object(value, where) {
  if (!isObject(value)) fail(`${where} must be an object`)
  return value
}

function only(value, keys, where) {
  for (const key of Object.keys(value)) if (!keys.includes(key)) fail(`${where} has an unknown field ${echo(key)}`)
}

function list(value, where, { min = 0, max }) {
  if (!Array.isArray(value)) fail(`${where} must be a list`)
  if (value.length < min) fail(`${where} needs at least ${min} item${min === 1 ? "" : "s"}`)
  if (value.length > max) fail(`${where} has more than ${max} items`)
  return value
}

function pattern(value, regex, where) {
  if (typeof value !== "string" || !regex.test(value)) fail(`${where} must match ${regex.source}`)
  return value
}

function integer(value, where, { min, max }) {
  if (!Number.isInteger(value) || value < min || value > max) fail(`${where} must be a whole number from ${min} to ${max}`)
  return value
}

function bool(value, where) {
  if (typeof value !== "boolean") fail(`${where} must be true or false`)
}

/** Display or template text: a string, at most `max` characters, no control characters, no unsafe shape. */
function text(value, where, { max, empty = false }) {
  if (typeof value !== "string") fail(`${where} must be text`)
  if (!empty && value.trim() === "") fail(`${where} must not be empty`)
  if (value.length > max) fail(`${where} is longer than ${max} characters`)
  if (CONTROL.test(value)) fail(`${where} has a control character`)
  if (shapes(value).any) fail(`${where} has an unsafe shape (an instruction, a permission or a share)`)
  return value
}

/** The tokens of a name: split on `_`, `.`, `-` and camelCase, lower case. */
function tokens(name) {
  return String(name)
    .split(/[_.\-]+/)
    .flatMap((part) => part.split(/(?<=[a-z0-9])(?=[A-Z])/))
    .map((part) => part.toLowerCase())
    .filter(Boolean)
}

/**
 * The forms a token may be a write verb in: itself, and without -ed, -ied,
 * -d or -ing (a doubled last consonant undone). Plurals (-s, -es, -ies) and
 * -er nouns are not: `labels`, `posts`, `sender` and `folder` are reads, and
 * a compound such as `read_and_deletes` is refused by its conjunction.
 */
function stems(token) {
  const out = new Set([token])
  for (const [suffix, back] of [["ied", "y"], ["ed", ""], ["d", ""], ["ing", ""]]) {
    if (!token.endsWith(suffix) || token.length <= suffix.length + 1) continue
    const base = token.slice(0, -suffix.length) + back
    out.add(base)
    out.add(`${base}e`)
    if (/([b-df-hj-np-tv-z])\1$/.test(base)) out.add(base.slice(0, -1))
  }
  return [...out]
}

/** The first token that is a write verb in any form, or a conjunction; null when there is none. */
function writeToken(name) {
  for (const token of tokens(name)) {
    if (CONJUNCTIONS.includes(token)) return { token, conjunction: true }
    const verb = stems(token).find((form) => WRITE_VERBS.includes(form))
    if (verb) return { token, verb }
  }
  return null
}

function writeReason(found, where = "") {
  return found.conjunction ? `"${found.token}"${where} joins two actions in one name` : `"${found.token}"${where} is a write verb (${found.verb})`
}

/**
 * Why a grant is refused, or null when it is inside the frame (§5.6).
 *
 * - `action` is `<ns>_<tail>` or `<ns>.<tail>`; a tail starting `<ns>_` (an
 *   MCP server of the same name) loses that prefix once.
 * - The tail is `events_list`; or `read` with a `[{account}:]<op>` resource
 *   whose op's last dotted segment starts with a read verb; or a tail whose
 *   first `_` token is a read verb.
 * - Every token of the tail, and of a `read` op, passes the write-verb check.
 * - No `*` or `?` in an action; a resource is `*` or a template whose only
 *   placeholder is `{account}`.
 *
 * @param {unknown} grant
 * @param {string} namespace
 * @returns {string | null}
 */
export function checkGrant(grant, namespace) {
  if (!isObject(grant)) return "a grant must be an object {action, resource}"
  for (const key of Object.keys(grant)) if (key !== "action" && key !== "resource") return `a grant has an extra field ${echo(key)}`
  const { action, resource } = grant
  if (typeof action !== "string" || action.length === 0 || action.length > 120) return "a grant's action must be text of at most 120 characters"
  const name = echo(action)
  if (typeof resource !== "string" || resource.length === 0 || resource.length > 200) return `${name}: the resource must be text of at most 200 characters`
  if (/[*?]/.test(action)) return `${name}: an action may not hold * or ?`
  if (!/^[A-Za-z0-9_.-]+$/.test(action)) return `${name}: an action is letters, digits, _, . and - only`
  const placeholders = resource.match(/\{[^}]*\}?/g) ?? []
  if (placeholders.some((item) => item !== "{account}") || /[{}]/.test(resource.replaceAll("{account}", ""))) return `${name}: a resource's only placeholder is {account}`
  if (resource !== "*" && resource.includes("*")) return `${name}: a resource is * or a template, not a pattern`
  let tail = null
  for (const separator of ["_", "."]) if (action.startsWith(`${namespace}${separator}`)) tail = action.slice(namespace.length + 1)
  if (tail === null) return `${name}: not in the namespace ${namespace}`
  if (tail.startsWith(`${namespace}_`)) tail = tail.slice(namespace.length + 1)
  if (tail === "") return `${name}: no tool name after the namespace`
  const write = writeToken(tail)
  if (write) return `${name}: ${writeReason(write)}`
  if (tail === "events_list") return null
  if (tail === "read") {
    const op = resource.startsWith("{account}:") ? resource.slice("{account}:".length) : resource
    if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(op)) return `${name}: a read resource is [{account}:]<op>, a dotted operation name`
    const opWrite = writeToken(op)
    if (opWrite) return `${name}: ${writeReason(opWrite, ` in ${echo(op)}`)}`
    const first = tokens(op.split(".").at(-1))[0]
    if (!READ_VERBS.includes(first)) return `${name}: ${echo(op)} does not start with a read verb (${READ_VERBS.join(", ")})`
    return null
  }
  const first = tail.split("_")[0]
  if (!READ_VERBS.includes(first)) return `${name}: "${echo(first)}" is not a read verb (${READ_VERBS.join(", ")})`
  return null
}

function grants(value, namespace, where) {
  list(value, where, { min: 0, max: MAX_GRANTS })
  if (value.length > MAX_GRANTS) fail(`${where}: at most ${MAX_GRANTS} grants`)
  const seen = new Set()
  for (const grant of value) {
    const reason = checkGrant(grant, namespace)
    if (reason) fail(`${where}: ${reason}`)
    const key = `${grant.action}\u0000${grant.resource}`
    if (seen.has(key)) fail(`${where}: ${grant.action} is listed twice`)
    seen.add(key)
  }
}

/**
 * A v2 grant (§9.1 A and D): `<ns>_<tool>` or `<ns>.<verb>`, a read verb
 * somewhere in the name and no write verb anywhere, and a resource of `*` or
 * `{account}:<operation>` whose last dotted segment starts with a read verb —
 * an allowlist, so an operation added to an API later is refused by default.
 */
function connectorGrants(value, namespace, where) {
  list(value, where, { min: 1, max: MAX_GRANTS })
  const seen = new Set()
  for (const grant of value) {
    object(grant, where)
    only(grant, ["action", "resource"], where)
    const { action, resource } = grant
    if (typeof action !== "string" || action.length === 0 || action.length > 120) fail(`${where}: an action must be text of at most 120 characters`)
    const name = echo(action)
    if (typeof resource !== "string" || resource.length === 0 || resource.length > 200) fail(`${where}: ${name}: the resource must be text of at most 200 characters`)
    if (/[*?]/.test(action) || !/^[A-Za-z0-9_.-]+$/.test(action)) fail(`${where}: ${name}: an action is letters, digits, _, . and - only, with no * or ?`)
    const write = writeToken(action)
    if (write) fail(`${where}: ${name}: ${writeReason(write)}`)
    if (!tokens(action).some((token) => READ_VERBS.includes(token))) fail(`${where}: ${name} has no read verb (${READ_VERBS.join(", ")})`)
    if (!action.startsWith(`${namespace}_`) && !action.startsWith(`${namespace}.`)) fail(`${where}: ${name} is not in the namespace ${namespace}`)
    const placeholders = resource.match(/\{[^}]*\}?/g) ?? []
    if (placeholders.some((item) => item !== "{account}") || /[{}]/.test(resource.replaceAll("{account}", ""))) fail(`${where}: ${name}: a resource's only placeholder is {account}`)
    if (resource !== "*" && resource.includes("*")) fail(`${where}: ${name}: a resource is * or a template, not a pattern`)
    if (resource !== "*") {
      const operation = resource.startsWith("{account}:") ? resource.slice("{account}:".length) : resource
      if (!/^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)*$/.test(operation)) fail(`${where}: ${name}: a read resource is {account}:<operation>, a dotted operation name`)
      const last = operation.split(".").at(-1)
      if (!READ_VERBS.some((verb) => tokens(last)[0]?.startsWith(verb) ?? last.startsWith(verb))) fail(`${where}: ${name}: ${echo(last)} does not start with a read verb (${READ_VERBS.join(", ")})`)
    }
    const key = `${action}\u0000${resource}`
    if (seen.has(key)) fail(`${where}: ${action} is listed twice`)
    seen.add(key)
  }
}

function checkSource(source, namespace, at) {
  object(source, at)
  only(source, ["id", "title", "summary", "contract", "input", "kinds", "grants", "probe", "scope", "cadence", "billing", "setup"], at)
  const id = pattern(source.id, ID, `${at}.id`)
  const where = `source ${id}`
  text(source.title, `${where}: title`, { max: 60 })
  text(source.summary, `${where}: summary`, { max: 200 })
  if (source.contract !== SOURCE_CONTRACT) fail(`${where}: contract must be ${SOURCE_CONTRACT} (events_list v2)`)
  if (source.input !== undefined) {
    object(source.input, `${where}: input`)
    if (Buffer.byteLength(canonicalJSON(source.input)) > MAX_INPUT_BYTES) fail(`${where}: input is larger than ${MAX_INPUT_BYTES} bytes`)
  }
  list(source.kinds, `${where}: kinds`, { min: 1, max: EVENT_KINDS.length })
  if (!source.kinds.every((kind) => EVENT_KINDS.includes(kind)) || new Set(source.kinds).size !== source.kinds.length) fail(`${where}: kinds must be distinct names from ${EVENT_KINDS.join(", ")}`)
  if (!Array.isArray(source.grants) || source.grants.length === 0) fail(`${where}: grants must list the actions events_list asserts`)
  if (source.grants.length > MAX_GRANTS) fail(`${where}: at most ${MAX_GRANTS} grants`)
  grants(source.grants, namespace, `${where}: grants`)
  if (source.probe !== undefined) {
    object(source.probe, `${where}: probe`)
    only(source.probe, ["grants"], `${where}: probe`)
    if (source.probe.grants !== undefined) {
      if (Array.isArray(source.probe.grants) && source.probe.grants.length > MAX_GRANTS) fail(`${where}: probe: at most ${MAX_GRANTS} grants`)
      grants(source.probe.grants, namespace, `${where}: probe.grants`)
    }
  }
  if (source.scope !== undefined) {
    list(source.scope, `${where}: scope`, { max: MAX_SCOPE_KEYS })
    const keys = new Set()
    for (const [index, item] of source.scope.entries()) {
      const at2 = `${where}: scope[${index}]`
      object(item, at2)
      only(item, ["key", "title", "kind", "pattern", "max", "required", "suggest"], at2)
      const key = pattern(item.key, /^[a-z][a-z0-9_]{0,31}$/, `${at2}.key`)
      if (keys.has(key)) fail(`${where}: scope key ${key} is listed twice`)
      keys.add(key)
      text(item.title, `${at2}.title`, { max: 60 })
      if (item.kind !== "ids") fail(`${at2}.kind must be "ids"`)
      if (typeof item.pattern !== "string" || item.pattern.length === 0 || item.pattern.length > 120) fail(`${at2}.pattern must be a regular expression of at most 120 characters`)
      try {
        new RegExp(item.pattern, "u")
      } catch {
        fail(`${at2}.pattern is not a valid regular expression`)
      }
      integer(item.max, `${at2}.max`, { min: 1, max: 64 })
      bool(item.required, `${at2}.required`)
      bool(item.suggest, `${at2}.suggest`)
    }
  }
  if (source.cadence !== undefined) {
    object(source.cadence, `${where}: cadence`)
    only(source.cadence, ["everyMinutes"], `${where}: cadence`)
    // Memory clamps it to at least 15 (120 when billed) at use; here it is only a number.
    integer(source.cadence.everyMinutes, `${where}: cadence.everyMinutes`, { min: 1, max: 10_080 })
  }
  if (source.billing !== undefined && source.billing !== null) {
    object(source.billing, `${where}: billing`)
    only(source.billing, ["unit", "note"], `${where}: billing`)
    if (source.billing.unit !== "call") fail(`${where}: billing.unit must be "call"`)
    if (source.billing.note !== undefined) text(source.billing.note, `${where}: billing.note`, { max: 200 })
  }
  if (source.setup !== undefined) text(source.setup, `${where}: setup`, { max: 300, empty: true })
  return id
}

/**
 * The markup a template's literal text may not carry: the block's own markers
 * (a `<!-- /lens -->` in a line would end the block early), an image or a link
 * (a line is text), an HTML tag, and a heading or quote (a line starts with the
 * block's own bullet).
 */
const LINE_MARKUP = Object.freeze([
  [/<!--|-->/, "an HTML comment, or a lens marker"],
  [/!\[/, "an image"],
  [/\]\(/, "a link"],
  [/<\/?[a-z]/i, "an HTML tag"],
  [/^\s*#{1,6}\s/, "a heading"],
  [/^\s*>\s/, "a quote"],
])

/**
 * Why a text carries markup a line may not have, or null. One judgement, used
 * on a template's literal text and again on the line **after** substitution:
 * a placeholder's value is collected text, so markup can arrive through it.
 */
export function lineMarkupProblem(value) {
  const text = String(value ?? "")
  for (const [pattern, what] of LINE_MARKUP) if (pattern.test(text)) return what
  return null
}

/** The characters that turn two placeholders into markup: `!{title}({url})`. */
const MARKUP_NEIGHBOURS = new Set(["!", "[", "]", "(", ")"])

/** A render line's literal text, with its placeholders checked and cut out, and no markup left in it. */
function renderLine(line, where) {
  text(line, where, { max: 200 })
  // A placeholder may not sit against the characters that make markup: the
  // rendered line is checked too, but a template that can build markup at all
  // is refused before it ever runs.
  for (const match of line.matchAll(/\{([^{}]*)\}/g)) {
    const name = match[1]
    const before = match.index > 0 ? line[match.index - 1] : ""
    const after = line[match.index + match[0].length] ?? ""
    for (const [side, neighbour] of [["before", before], ["after", after]]) {
      if (MARKUP_NEIGHBOURS.has(neighbour)) fail(`${where}: the placeholder {${echo(name)}} sits next to "${neighbour}" (${side} it), which makes markup. Put a space between them`)
    }
  }
  const literal = line.replace(/\{([^{}]*)\}/g, (_, name) => {
    if (RENDER_PLACEHOLDERS.includes(name)) return " "
    if (/^metric:/.test(name) && METRIC.test(name.slice("metric:".length))) return " "
    fail(`${where}: {${echo(name)}} is not a placeholder (${RENDER_PLACEHOLDERS.map((p) => `{${p}}`).join(", ")}, {metric:<key>})`)
  })
  if (/[{}]/.test(literal)) fail(`${where}: an unmatched { or }`)
  const markup = lineMarkupProblem(literal)
  if (markup) fail(`${where} carries markup: ${markup}. A line is text; the block's markers are Memory's`)
  text(literal, where, { max: 200, empty: true })
}

function checkOutput(output, engine, where) {
  if (typeof output !== "string") fail(`${where}: an output must be text`)
  if (output === "journal" || output === "timeline") return
  if (output.startsWith("section:")) {
    if (engine !== "render") fail(`${where}: a section output is for the render engine only`)
    text(output.slice("section:".length), `${where}: the section heading`, { max: 60 })
    return
  }
  if (output.startsWith("proposal:") && PROPOSAL_OUTPUTS.includes(output.slice("proposal:".length))) {
    if (engine !== "extract") fail(`${where}: proposals come from the extract engine only`)
    return
  }
  fail(`${where}: ${echo(output)} is not an output kind (journal, timeline, section:<Heading>, proposal:${PROPOSAL_OUTPUTS.join("|")})`)
}

function checkRoutine(routine, sources, at) {
  object(routine, at)
  only(routine, ["id", "title", "summary", "on", "engine", "select", "hints", "render", "outputs", "budget"], at)
  const id = pattern(routine.id, ID, `${at}.id`)
  const where = `routine ${id}`
  text(routine.title, `${where}: title`, { max: 60 })
  text(routine.summary, `${where}: summary`, { max: 200 })
  if (!CADENCES.includes(routine.on)) fail(`${where}: on must be ${CADENCES.join(", ")}`)
  if (!ENGINES.includes(routine.engine)) fail(`${where}: engine must be render or extract`)
  const select = object(routine.select, `${where}: select`)
  only(select, ["sources", "kinds", "labels", "unit", "participant", "latest", "window", "minEvents", "maxUnits"], `${where}: select`)
  list(select.sources, `${where}: select.sources`, { min: 1, max: MAX_SOURCES })
  for (const name of select.sources) if (typeof name !== "string" || !sources.has(name)) fail(`${where}: select.sources may name only this plugin's own sources`)
  if (select.kinds !== undefined) {
    const allowed = new Set(select.sources.flatMap((name) => sources.get(name)))
    list(select.kinds, `${where}: select.kinds`, { min: 1, max: EVENT_KINDS.length })
    if (!select.kinds.every((kind) => allowed.has(kind))) fail(`${where}: select.kinds must be kinds its sources declare`)
  }
  if (select.labels !== undefined) {
    list(select.labels, `${where}: select.labels`, { min: 1, max: 16 })
    for (const label of select.labels) pattern(label, LABEL, `${where}: a label`)
  }
  if (!UNITS.includes(select.unit)) fail(`${where}: select.unit must be event or thread`)
  if (select.participant !== undefined && select.participant !== "owner") fail(`${where}: select.participant may only be "owner"`)
  if (select.latest !== undefined) {
    object(select.latest, `${where}: select.latest`)
    only(select.latest, ["per"], `${where}: select.latest`)
    pattern(select.latest.per, LABEL_PREFIX, `${where}: select.latest.per`)
  }
  if (!WINDOWS.includes(select.window)) fail(`${where}: select.window must be ${WINDOWS.join(", ")}`)
  if (select.minEvents !== undefined) integer(select.minEvents, `${where}: select.minEvents`, { min: 1, max: 1000 })
  if (select.maxUnits !== undefined) integer(select.maxUnits, `${where}: select.maxUnits`, { min: 1, max: 200 })
  if (routine.engine === "extract") {
    if (routine.render !== undefined) fail(`${where}: render is for the render engine only`)
    if (routine.hints !== undefined) text(routine.hints, `${where}: hints`, { max: MAX_HINTS })
    if (routine.budget !== undefined) {
      object(routine.budget, `${where}: budget`)
      only(routine.budget, ["tokensPerRun"], `${where}: budget`)
      // Clamped to MAX_TOKENS_PER_RUN at use (§4.6); here only a positive number.
      integer(routine.budget.tokensPerRun, `${where}: budget.tokensPerRun`, { min: 1, max: 1_000_000 })
    }
  } else {
    if (routine.hints !== undefined) fail(`${where}: hints are for the extract engine only`)
    if (routine.budget !== undefined) fail(`${where}: a budget is for the extract engine only`)
    const render = object(routine.render, `${where}: render`)
    only(render, ["into", "heading", "line", "max"], `${where}: render`)
    if (render.into !== "journal" && render.into !== "section") fail(`${where}: render.into must be journal or section`)
    text(render.heading, `${where}: render.heading`, { max: 60 })
    renderLine(render.line, `${where}: render.line`)
    integer(render.max, `${where}: render.max`, { min: 1, max: MAX_RENDER_ITEMS })
  }
  list(routine.outputs, `${where}: outputs`, { min: 1, max: 12 })
  if (new Set(routine.outputs).size !== routine.outputs.length) fail(`${where}: an output is listed twice`)
  for (const output of routine.outputs) checkOutput(output, routine.engine, `${where}: outputs`)
  return id
}

/**
 * Validate a `package.json#memory` value against `memory-plugin.v2` (or v1, the
 * schema before connectors) and the frame. Never throws.
 *
 * @param {unknown} value
 * @returns {{ ok: true, errors: [], reason: null, namespace: string } | { ok: false, errors: string[], reason: string }}
 */
export function validateManifest(value) {
  try {
    const manifest = object(value, "the memory section")
    if (deeperThan(manifest, MAX_DEPTH)) fail(`the memory section is nested deeper than ${MAX_DEPTH} levels`)
    if (!Number.isInteger(manifest.version) || !SCHEMA_VERSIONS.includes(manifest.version)) fail(`version must be ${SCHEMA_VERSIONS.join(" or ")} (memory-plugin.v${SCHEMA_VERSION})`)
    const namespace = manifest.version === 1 ? checkManifestV1(manifest) : checkManifestV2(manifest)
    canonicalJSON(manifest)
    return { ok: true, errors: [], reason: null, namespace }
  } catch (error) {
    const reason = error instanceof Invalid ? error.message : "the memory section could not be read"
    return { ok: false, errors: [reason.slice(0, 300)], reason: reason.slice(0, 300) }
  }
}

/** v1: sources of events and routines over them. Kept while a v1 plugin is installed. */
function checkManifestV1(manifest) {
  only(manifest, ["$schema", "version", "namespace", "sources", "routines"], "the memory section")
  if (manifest.$schema !== undefined && (typeof manifest.$schema !== "string" || manifest.$schema.length > 300)) fail("$schema must be a URL of at most 300 characters")
  const namespace = namespaceOf(manifest)
  list(manifest.sources, "sources", { min: 1, max: MAX_SOURCES })
  const sources = new Map()
  for (const [index, source] of manifest.sources.entries()) {
    const id = checkSource(source, namespace, `sources[${index}]`)
    if (sources.has(id)) fail(`duplicate source id ${id}`)
    sources.set(id, source.kinds)
  }
  if (manifest.routines !== undefined) {
    list(manifest.routines, "routines", { max: MAX_ROUTINES })
    const ids = new Set()
    for (const [index, routine] of manifest.routines.entries()) {
      const id = checkRoutine(routine, sources, `routines[${index}]`)
      if (ids.has(id)) fail(`duplicate routine id ${id}`)
      ids.add(id)
    }
  }
  return namespace
}

/** The namespace both schemas share, reserved names refused. */
function namespaceOf(manifest) {
  const namespace = pattern(manifest.namespace, NAMESPACE, "namespace")
  if (RESERVED_NAMESPACES.includes(namespace)) fail(`namespace ${namespace} is reserved`)
  return namespace
}

// ---------------------------------------------------------------------------
// v2 (§9): the connector, its sources' identities, its reads, and its templates

/** A v2 section key the schema does not define, with the rename the design made where there is one. */
function onlyV2(value, keys, where) {
  for (const key of Object.keys(value)) {
    if (keys.includes(key)) continue
    fail(key === "setup" ? `${where} has the unknown field setup: the static line is setupHint (§9.2)` : `${where} has an unknown field ${echo(key)}`)
  }
}

function checkManifestV2(manifest) {
  only(manifest, ["$schema", "version", "namespace", "connector", "sources", "templates"], "the memory section")
  if (typeof manifest.$schema !== "string" || manifest.$schema.length > 300) fail("$schema must be a URL of at most 300 characters")
  const namespace = namespaceOf(manifest)
  const connector = checkConnector(manifest.connector, namespace)
  list(manifest.sources, "sources", { min: 1, max: MAX_SOURCES })
  const sources = new Map()
  for (const [index, source] of manifest.sources.entries()) {
    const id = checkConnectorSource(source, namespace, connector, `sources[${index}]`)
    if (sources.has(id)) fail(`duplicate source id ${id}`)
    sources.set(id, source)
  }
  // §9.1 D: a source's grants are a job's grants, so a suggestBy grant that is one
  // of them has entered a job by the back door.
  for (const source of sources.values()) {
    for (const grant of source.grants) {
      if (connector.suggest.has(grant.action)) fail(`source ${source.id}: ${grant.action} is a suggestBy grant and also a source's grant: suggestBy runs only at bind, so it is never a job's (§9.1 D)`)
    }
  }
  // §9.2: a connector-wide default identity is enough until one sign-in differs;
  // a source with none of its own needs the connector's.
  if (!connector.identity && ![...sources.values()].every((source) => source.identity)) {
    fail(`a source declares no identity and the connector has none, so Memory cannot read which account it is (§9.2)`)
  }
  if (manifest.templates !== undefined) {
    list(manifest.templates, "templates", { max: MAX_TEMPLATES })
    const ids = new Set()
    for (const [index, template] of manifest.templates.entries()) {
      const id = checkTemplate(template, new Set(sources.keys()), `templates[${index}]`, connector.reads)
      if (ids.has(id)) fail(`duplicate template id ${id}`)
      ids.add(id)
    }
  }
  return namespace
}

/**
 * §9.1 B and D: the connector's accounts, its own scope keys with their
 * `suggestBy`, its declared reads, and whether it claims `operationScoped`.
 */
function checkConnector(connector, namespace) {
  object(connector, "the connector")
  onlyV2(connector, ["accounts", "identity", "identityRead", "operationScoped", "reads", "scope", "billing", "urlHosts"], "the connector")
  if (connector.accounts !== "single" && connector.accounts !== "multi") fail(`connector.accounts must be "single" or "multi"`)
  if (connector.operationScoped !== undefined) bool(connector.operationScoped, "connector.operationScoped")
  if (connector.identity !== undefined) checkIdentity(connector.identity, namespace, "the connector's identity", { sourceLevel: true })
  if (connector.identityRead !== undefined) checkIdentity(connector.identityRead, namespace, "the connector's identityRead", { sourceLevel: false })
  const scopeKeys = checkScope(connector.scope, namespace, "the connector's scope")
  const reads = checkReads(connector.reads, namespace, scopeKeys)
  // §9.1 B: `operationScoped` is a claim Memory can check and acts on: every
  // dotted action's grant names its operation, so a job may call a direct read.
  if (connector.operationScoped === true) {
    const dotted = [...reads.values()].flatMap((read) => read.grants).filter((grant) => grant.action.includes("."))
    if (dotted.length === 0) fail("connector.operationScoped is true, but no read declares a dotted action with an operation resource")
    for (const grant of dotted) if (grant.resource === "*") fail(`connector.operationScoped is true, so ${grant.action} must name {account}:<operation>, not "*"`)
  }
  if (connector.billing !== undefined && connector.billing !== null) billing(connector.billing, "connector.billing")
  // §9.4: the hosts a templated `{url}` may point at. A destination is a
  // security decision, so a connector declares its own and nothing else renders.
  const urlHosts = []
  if (connector.urlHosts !== undefined) {
    list(connector.urlHosts, "connector.urlHosts", { max: 8 })
    for (const host of connector.urlHosts) {
      const problem = urlHostProblem(host)
      if (problem) fail(`connector.urlHosts: ${echo(host)} ${problem}`)
      urlHosts.push(host.toLowerCase())
    }
  }
  // §9.1 D: a suggestBy read runs only at bind, so its grants must never be a
  // job-bearing grant: no identity, no identityRead, and no declared read.
  const suggest = (Array.isArray(connector.scope) ? connector.scope : []).flatMap((key) => (Array.isArray(key?.suggestBy?.grants) ? key.suggestBy.grants : [])).map((grant) => grant.action)
  const bearing = new Set([connector.identity, connector.identityRead, ...(Array.isArray(connector.reads) ? connector.reads : [])]
    .flatMap((block) => (Array.isArray(block?.grants) ? block.grants : []))
    .map((grant) => grant.action))
  for (const action of new Set(suggest)) if (bearing.has(action)) fail(`${action} is a suggestBy grant and also a job-bearing grant: suggestBy runs only at bind, so its grants must not appear in an identity, identityRead or read (§9.1 D)`)
  return { identity: connector.identity, identityRead: connector.identityRead, scopeKeys, reads, suggest: new Set(suggest), urlHosts }
}

/** §9.2: an identity answers the account and the owner, and nothing else. */
function checkIdentity(identity, namespace, where, { sourceLevel }) {
  object(identity, where)
  onlyV2(identity, ["method", "input", "grants", "account", "owner"], where)
  if (sourceLevel) {
    if (identity.method !== "events_list") fail(`${where}: method must be events_list: a source's identity is its limit:0 call (§9.2)`)
    if (identity.input !== undefined) {
      object(identity.input, `${where}: input`)
      for (const key of Object.keys(identity.input)) if (!["source", "account", "limit"].includes(key)) fail(`${where}: input may name only source, account and limit`)
      if (identity.input.limit !== 0) fail(`${where}: input.limit must be 0: the identity is the owner-only call, and any other limit reads events`)
    }
    if (Object.keys(identity.input ?? {}).length === 0) fail(`${where}: input must name the source and limit 0`)
  } else {
    if (typeof identity.method !== "string" || identity.method === "events_list") fail(`${where}: method must name the tools RPC read that answers the account (§9.2)`)
    readName(identity.method, `${where}: method`)
  }
  connectorGrants(identity.grants, namespace, `${where}: grants`)
  if (typeof identity.account !== "string" || !identity.account.startsWith("$.")) fail(`${where}: account must be a JSONPath starting $.`)
  object(identity.owner, `${where}: owner`)
  only(identity.owner, ["id", "label"], `${where}: owner`)
  for (const key of ["id", "label"]) if (typeof identity.owner[key] !== "string" || !identity.owner[key].startsWith("$.")) fail(`${where}: owner.${key} must be a JSONPath starting $.`)
}

/** A read's method name: the verb allowlist, and no write verb anywhere (§9.1 A). */
function readName(name, where) {
  if (typeof name !== "string" || name.length === 0 || name.length > 120) fail(`${where} must be a name of at most 120 characters`)
  const write = writeToken(name)
  if (write) fail(`${where}: ${writeReason(write)}`)
  if (!tokens(name).some((token) => READ_VERBS.includes(token))) fail(`${where}: "${echo(name)}" has no read verb (${READ_VERBS.join(", ")})`)
}

/**
 * §9.1 C: a scope key is what the person confirms. `suggestBy` runs only at
 * bind, so its grants are checked like any other read's and kept out of jobs.
 */
function checkScope(scope, namespace, where) {
  if (!Array.isArray(scope)) fail(`${where} must be a list, empty when none`)
  list(scope, where, { max: MAX_SCOPE_KEYS })
  const keys = new Set()
  for (const [index, entry] of scope.entries()) {
    const at = `${where}[${index}]`
    object(entry, at)
    onlyV2(entry, ["key", "title", "kind", "pattern", "max", "required", "suggest", "suggestBy"], at)
    const key = pattern(entry.key, /^[a-z][a-z0-9_]{0,31}$/, `${at}.key`)
    if (keys.has(key)) fail(`${where}: scope key ${key} is listed twice`)
    keys.add(key)
    if (entry.title !== undefined) text(entry.title, `${at}.title`, { max: 60 })
    if (entry.kind !== "ids") fail(`${at}.kind must be "ids"`)
    if (typeof entry.pattern !== "string" || entry.pattern.length === 0 || entry.pattern.length > 120) fail(`${at}.pattern must be a regular expression of at most 120 characters`)
    try {
      new RegExp(entry.pattern, "u")
    } catch {
      fail(`${at}.pattern is not a valid regular expression`)
    }
    integer(entry.max, `${at}.max`, { min: 1, max: 64 })
    bool(entry.required, `${at}.required`)
    if (entry.suggest !== undefined) bool(entry.suggest, `${at}.suggest`)
    if (entry.suggest === true && entry.suggestBy === undefined) fail(`${at} claims suggest: true but declares no suggestBy, so Memory has nothing to call`)
    if (entry.suggestBy !== undefined) {
      object(entry.suggestBy, `${at}.suggestBy`)
      onlyV2(entry.suggestBy, ["method", "input", "grants", "ids", "labels"], `${at}.suggestBy`)
      readName(entry.suggestBy.method, `${at}.suggestBy.method`)
      if (entry.suggestBy.input !== undefined) object(entry.suggestBy.input, `${at}.suggestBy.input`)
      connectorGrants(entry.suggestBy.grants, namespace, `${at}.suggestBy: grants`)
      for (const field of ["ids", "labels"]) {
        if (entry.suggestBy[field] !== undefined && (typeof entry.suggestBy[field] !== "string" || !entry.suggestBy[field].startsWith("$."))) fail(`${at}.suggestBy.${field} must be a JSONPath starting $.`)
      }
    }
  }
  return keys
}

/** §9.1 B and C: each declared read, its grants, and the scope inputs that pin it. */
function checkReads(reads, namespace, scopeKeys) {
  const byMethod = new Map()
  if (reads === undefined) return byMethod
  list(reads, "connector.reads", { max: MAX_READS })
  for (const [index, read] of reads.entries()) {
    const at = `connector.reads[${index}]`
    object(read, at)
    onlyV2(read, ["method", "input", "grants", "scopeInputs", "kinds", "cursor", "billing"], at)
    readName(read.method, `${at}.method`)
    if (byMethod.has(read.method)) fail(`${at}.method ${echo(read.method)} is declared twice`)
    if (read.input !== undefined) {
      object(read.input, `${at}.input`)
      if (Buffer.byteLength(canonicalJSON(read.input)) > MAX_INPUT_BYTES) fail(`${at}: input is larger than ${MAX_INPUT_BYTES} bytes`)
    }
    connectorGrants(read.grants, namespace, `${at}: grants`)
    checkScopeInputs(read.scopeInputs, `${at}.scopeInputs`, scopeKeys)
    if (read.kinds !== undefined) {
      list(read.kinds, `${at}.kinds`, { min: 1, max: EVENT_KINDS.length })
      if (!read.kinds.every((kind) => EVENT_KINDS.includes(kind))) fail(`${at}.kinds must be names from ${EVENT_KINDS.join(", ")}`)
    }
    if (read.cursor !== undefined) text(read.cursor, `${at}.cursor`, { max: 60 })
    if (read.billing !== undefined && read.billing !== null) billing(read.billing, `${at}.billing`)
    byMethod.set(read.method, read)
  }
  return byMethod
}

/**
 * §9.1 C, as the kit checks it: a read is pinned to the confirmed scope by at
 * least one binding-key input; a `perUnit` input takes its value from the event
 * itself, and every `perUnit` of one read shares one `bind`; a `thread_ts`
 * needs its `thread_channel` on the same bind, so a thread's channel is what
 * keeps it inside the confirmed scope.
 */
function checkScopeInputs(inputs, where, scopeKeys) {
  if (inputs === undefined) fail(`${where} is missing: a read with no scope input is unscoped and not grantable`)
  object(inputs, where)
  if (Object.keys(inputs).length === 0) fail(`${where} is empty: a read with no scope input is unscoped and not grantable`)
  let bound = 0
  const binds = new Set()
  const perUnit = []
  for (const [field, value] of Object.entries(inputs)) {
    if (typeof value === "string") {
      if (!scopeKeys.has(value)) fail(`${where}.${field} names the scope key "${echo(value)}", which the connector's scope does not declare`)
      bound += 1
      continue
    }
    object(value, `${where}.${field}`)
    onlyV2(value, ["perUnit", "bind"], `${where}.${field}`)
    if (!PER_UNIT_FIELDS.includes(value.perUnit)) fail(`${where}.${field}: perUnit must be one of ${PER_UNIT_FIELDS.join(", ")} (a field of the event shape)`)
    if (typeof value.bind !== "string" || !scopeKeys.has(value.bind)) fail(`${where}.${field}: perUnit needs bind to name a declared scope key, so the id stays inside the confirmed scope`)
    binds.add(value.bind)
    perUnit.push([field, value])
  }
  // §9.1 C: external_id is a per-unit value like any other, but it names no
  // conversation: a read pinned only by it is pinned by nothing.
  if (perUnit.length > 0 && perUnit.every(([, value]) => value.perUnit === "external_id")) fail(`${where} is pinned only by external_id, which names no conversation: a read needs a confirmed scope key (§9.1 C)`)
  const ts = perUnit.find(([, value]) => value.perUnit === "thread_ts")
  if (ts && !perUnit.some(([, value]) => value.perUnit === "thread_channel" && value.bind === ts[1].bind)) {
    fail(`${where}.${ts[0]}: a thread_ts needs a thread_channel input on the same bind, so the thread's channel is pinned to the confirmed scope`)
  }
  if (binds.size > 1) fail(`${where} binds per-unit inputs to ${[...binds].join(", ")}: they must all name one scope key`)
  if (bound === 0 && binds.size === 0) fail(`${where} pins no binding-key input, so the read is not scoped to what the person confirmed`)
  if (bound > 0 && binds.size > 0) {
    for (const key of binds) {
      if (!Object.values(inputs).includes(key)) fail(`${where} pins a per-unit input through the unrelated key ${key}: its bind must be one of this read's binding-key inputs`)
    }
  }
}

/** §9.2: a source's grants are exactly what `events_list` asserts; its identity's are among them. */
function checkConnectorSource(source, namespace, connector, at) {
  object(source, at)
  onlyV2(source, ["id", "title", "summary", "contract", "input", "kinds", "grants", "identity", "scope", "cadence", "billing", "setupHint"], at)
  const id = pattern(source.id, ID, `${at}.id`)
  const where = `source ${id}`
  text(source.title, `${where}: title`, { max: 60 })
  text(source.summary, `${where}: summary`, { max: 200 })
  if (source.contract !== SOURCE_CONTRACT) fail(`${where}: contract must be ${SOURCE_CONTRACT} (events_list v2)`)
  if (source.input !== undefined) {
    object(source.input, `${where}: input`)
    if (Buffer.byteLength(canonicalJSON(source.input)) > MAX_INPUT_BYTES) fail(`${where}: input is larger than ${MAX_INPUT_BYTES} bytes`)
  }
  list(source.kinds, `${where}: kinds`, { min: 1, max: EVENT_KINDS.length })
  if (!source.kinds.every((kind) => EVENT_KINDS.includes(kind)) || new Set(source.kinds).size !== source.kinds.length) fail(`${where}: kinds must be distinct names from ${EVENT_KINDS.join(", ")}`)
  if (!Array.isArray(source.grants) || source.grants.length === 0) fail(`${where}: grants must list the actions events_list asserts`)
  connectorGrants(source.grants, namespace, `${where}: grants`)
  if (source.identity !== undefined) {
    checkIdentity(source.identity, namespace, `${where}: identity`, { sourceLevel: true })
  }
  // §9.1 D: an identity's grants are only what `limit: 0` asserts, and they must
  // be among the source's — that list is what a job's session allows for it.
  const identity = source.identity ?? connector.identity
  if (identity) {
    const listed = new Set(source.grants.map((grant) => `${grant.action}\u0000${grant.resource}`))
    for (const grant of identity.grants) {
      if (!listed.has(`${grant.action}\u0000${grant.resource}`)) fail(`${where}: identity grants ${grant.action} on ${grant.resource}, which ${where}: grants does not list — an identity's grants must be among the source's (§9.1 D)`)
    }
  }
  if (source.scope !== undefined) {
    list(source.scope, `${where}: scope`, { max: MAX_SCOPE_KEYS })
    const keys = new Set()
    for (const [index, item] of source.scope.entries()) {
      const at2 = `${where}: scope[${index}]`
      object(item, at2)
      onlyV2(item, ["key", "title", "kind", "pattern", "max", "required", "suggest"], at2)
      const key = pattern(item.key, /^[a-z][a-z0-9_]{0,31}$/, `${at2}.key`)
      if (keys.has(key)) fail(`${where}: scope key ${key} is listed twice`)
      keys.add(key)
      if (!connector.scopeKeys.has(key)) fail(`${at2} names ${key}, which the connector's scope does not declare`)
    }
  }
  if (source.cadence !== undefined) {
    object(source.cadence, `${where}: cadence`)
    only(source.cadence, ["everyMinutes"], `${where}: cadence`)
    // Memory clamps it to at least 15 (120 when billed) at use; here it is only a number.
    integer(source.cadence.everyMinutes, `${where}: cadence.everyMinutes`, { min: 1, max: 10_080 })
  }
  if (source.billing !== undefined && source.billing !== null) billing(source.billing, `${where}: billing`)
  if (source.setupHint !== undefined) text(source.setupHint, `${where}: setupHint`, { max: 300, empty: true })
  return id
}

function billing(value, where) {
  object(value, where)
  only(value, ["unit", "note"], where)
  if (value.unit !== "call") fail(`${where}.unit must be "call"`)
  if (value.note !== undefined) text(value.note, `${where}.note`, { max: 200 })
}

/**
 * §9.4: a template is a draft job a person can instantiate. It carries no
 * grants and no account, so it can never widen what the person confirmed.
 */
function checkTemplate(template, sourceIds, at, reads = new Map()) {
  object(template, at)
  onlyV2(template, ["id", "title", "summary", "trigger", "extract", "transform", "curate", "outputs", "budget"], at)
  const id = pattern(template.id, ID, `${at}.id`)
  const where = `template ${id}`
  text(template.title, `${where}: title`, { max: 60 })
  text(template.summary, `${where}: summary`, { max: 200 })
  if (template.trigger !== undefined) {
    object(template.trigger, `${where}: trigger`)
    only(template.trigger, ["schedule"], `${where}: trigger`)
    object(template.trigger.schedule, `${where}: trigger.schedule`)
    only(template.trigger.schedule, ["every", "cron", "tz"], `${where}: trigger.schedule`)
    if (template.trigger.schedule.every !== undefined) pattern(template.trigger.schedule.every, /^[0-9]{1,4}(m|h|d)$/, `${where}: trigger.schedule.every`)
    if (template.trigger.schedule.cron !== undefined) text(template.trigger.schedule.cron, `${where}: trigger.schedule.cron`, { max: 120 })
    if (template.trigger.schedule.tz !== undefined) text(template.trigger.schedule.tz, `${where}: trigger.schedule.tz`, { max: 64 })
  }
  const extract = object(template.extract, `${where}: extract`)
  only(extract, ["steps"], `${where}: extract`)
  const steps = list(extract.steps, `${where}: extract.steps`, { min: 1, max: 8 })
  for (const [index, step] of steps.entries()) {
    const at2 = `${where}: extract.steps[${index}]`
    object(step, at2)
    onlyV2(step, ["use", "call", "connector", "source", "for", "with", "paginate", "cursor", "emit"], at2)
    const byUse = step.use !== undefined
    const byCall = typeof step.call === "string"
    if (byUse === byCall) fail(`${at2} needs exactly one of use (events_list) and call`)
    if (byUse && step.use !== "events_list") fail(`${at2}.use must be events_list`)
    if (byCall) readName(step.call, `${at2}.call`)
    pattern(step.connector, /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/, `${at2}.connector`)
    if (typeof step.source !== "string" || !sourceIds.has(step.source)) fail(`${at2}.source must name one of this plugin's declared sources`)
    if (step.for !== undefined && step.for !== "thread" && step.for !== "unit") fail(`${at2}.for must be "thread" or "unit"`)
    if (step.with !== undefined) {
      object(step.with, `${at2}.with`)
      // §9.1 C: the read pins these itself, from the person's confirmed scope.
      // A template that set one would replace the pin, so it may not.
      const pinned = new Set(Object.keys(byCall ? reads.get(step.call)?.scopeInputs ?? {} : {}))
      for (const key of Object.keys(step.with)) {
        if (pinned.has(key)) fail(`${at2}.with may not set ${echo(key)}: the read pins it from the person's confirmed scope, and a template cannot replace that (§9.1 C)`)
      }
      // §2.2: a step's inputs are binding values only, never an event's text.
      for (const match of JSON.stringify(step.with).matchAll(/\{\{([^}]+)\}\}/g)) {
        const ref = match[1].trim()
        if (!/^(account|since|cursor\.[a-z][a-z0-9_]*|scope\.[a-z][a-z0-9_]*)$/.test(ref)) fail(`${at2}.with uses {{${echo(ref)}}}: only binding values are allowed, never item text`)
      }
    }
  }
  if (template.transform !== undefined) {
    object(template.transform, `${where}: transform`)
    only(template.transform, ["into", "map"], `${where}: transform`)
    if (template.transform.into !== "events" && template.transform.into !== "documents") fail(`${where}: transform.into must be events or documents`)
    if (template.transform.map !== undefined) object(template.transform.map, `${where}: transform.map`)
  }
  const curate = object(template.curate, `${where}: curate`)
  only(curate, ["stages"], `${where}: curate`)
  const stages = list(curate.stages, `${where}: curate.stages`, { min: 1, max: 8 })
  const written = []
  for (const [index, stage] of stages.entries()) {
    const at2 = `${where}: curate.stages[${index}]`
    object(stage, at2)
    onlyV2(stage, ["engine", "select", "into", "heading", "line", "max", "hints", "outputs"], at2)
    if (stage.engine !== "render" && stage.engine !== "extract" && stage.engine !== "synthesize") fail(`${at2}.engine must be render, extract or synthesize`)
    if (stage.engine === "render") {
      const into = stage.into
      const isSection = typeof into === "string" && /^section:[A-Z][A-Za-z0-9 ]{0,39}$/.test(into)
      if (!isSection && into !== "journal" && into !== "timeline") fail(`${at2}.into must be journal, timeline or section:<Heading>`)
      if (typeof stage.line !== "string" || stage.line.length === 0 || stage.line.length > 400) fail(`${at2}.line must be 1 to 400 characters`)
      renderLine(stage.line, `${at2}.line`)
      integer(stage.max, `${at2}.max`, { min: 1, max: MAX_RENDER_ITEMS })
      if (stage.heading !== undefined) text(stage.heading, `${at2}.heading`, { max: 60 })
      if (stage.outputs !== undefined) fail(`${at2}: a render stage's output is its into`)
      written.push(into)
    }
    if (stage.engine === "extract") {
      const outputs = list(stage.outputs, `${at2}.outputs`, { min: 1, max: 12 })
      for (const output of outputs) {
        if (!output.startsWith("proposal:") || !PROPOSAL_OUTPUTS.includes(output.slice("proposal:".length))) fail(`${at2}.outputs names ${echo(output)}, which is not a proposal kind`)
        written.push(output)
      }
      if (stage.hints !== undefined) text(stage.hints, `${at2}.hints`, { max: MAX_HINTS })
      if (stage.into !== undefined || stage.line !== undefined) fail(`${at2}: an extract stage takes outputs and hints, not into or line`)
    }
    if (stage.engine === "synthesize") {
      if (typeof stage.into !== "string" || !/^section:[A-Z][A-Za-z0-9 ]{0,39}$/.test(stage.into)) fail(`${at2}.into must be section:<Heading>`)
      integer(stage.max, `${at2}.max`, { min: 1, max: MAX_RENDER_ITEMS })
      written.push(stage.into)
    }
    if (stage.select !== undefined) checkSelector(stage.select, sourceIds, `${at2}.select`)
  }
  const outputs = list(template.outputs, `${where}: outputs`, { min: 1, max: 12 })
  if (new Set(outputs).size !== outputs.length) fail(`${where}: an output is listed twice`)
  for (const output of outputs) {
    if (output === "journal" || output === "timeline") continue
    if (typeof output === "string" && /^section:[A-Z][A-Za-z0-9 ]{0,39}$/.test(output)) continue
    if (typeof output === "string" && output.startsWith("proposal:") && PROPOSAL_OUTPUTS.includes(output.slice("proposal:".length))) continue
    fail(`${where}: outputs names ${echo(output)}, which is not an output kind`)
  }
  // §9.1 D: a template's outputs cover every stage's, or a stage would write what
  // the person never saw in the draft.
  for (const output of new Set(written)) if (!outputs.includes(output)) fail(`${where}: outputs must include ${echo(output)}, which a stage writes`)
  if (template.budget !== undefined) {
    object(template.budget, `${where}: budget`)
    only(template.budget, ["tokensPerRun"], `${where}: budget`)
    integer(template.budget.tokensPerRun, `${where}: budget.tokensPerRun`, { min: 1000, max: MAX_TOKENS_PER_RUN })
  }
  return id
}

/** The selector a stage reads units with (§9.4). */
function checkSelector(select, sourceIds, where) {
  object(select, where)
  only(select, ["sources", "kinds", "labels", "unit", "participant", "latest", "window", "minEvents", "maxUnits"], where)
  if (select.sources !== undefined) {
    list(select.sources, `${where}.sources`, { min: 1, max: MAX_SOURCES })
    for (const name of select.sources) if (typeof name !== "string" || !sourceIds.has(name)) fail(`${where}.sources may name only this plugin's own sources`)
  }
  if (select.kinds !== undefined) {
    list(select.kinds, `${where}.kinds`, { min: 1, max: EVENT_KINDS.length })
    if (!select.kinds.every((kind) => EVENT_KINDS.includes(kind))) fail(`${where}.kinds must be event kinds`)
  }
  if (select.labels !== undefined) {
    list(select.labels, `${where}.labels`, { min: 1, max: 16 })
    for (const label of select.labels) pattern(label, LABEL, `${where}: a label`)
  }
  if (select.unit !== undefined && !UNITS.includes(select.unit)) fail(`${where}.unit must be event or thread`)
  if (select.participant !== undefined && select.participant !== "owner") fail(`${where}.participant may only be "owner"`)
  if (select.latest !== undefined) {
    object(select.latest, `${where}.latest`)
    only(select.latest, ["per"], `${where}.latest`)
    pattern(select.latest.per, LABEL_PREFIX, `${where}.latest.per`)
  }
  if (select.window !== undefined && !WINDOWS.includes(select.window)) fail(`${where}.window must be ${WINDOWS.join(", ")}`)
  if (select.minEvents !== undefined) integer(select.minEvents, `${where}.minEvents`, { min: 1, max: 1000 })
  if (select.maxUnits !== undefined) integer(select.maxUnits, `${where}.maxUnits`, { min: 1, max: 200 })
}

// ---------------------------------------------------------------------------
// What a job reads: the identity, the declared reads, the templates, and the
// exact grant set of §9.1 D

/** The identity a source reads its account and owner with: its own, else the connector's (§9.2). */
export function identityFor(manifest, sourceId) {
  const source = (manifest?.sources ?? []).find((entry) => entry?.id === sourceId) ?? null
  if (!source) return null
  return source.identity ?? manifest?.connector?.identity ?? null
}

/** Every read the connector declares, by method. */
export function declaredReads(manifest) {
  return Array.isArray(manifest?.connector?.reads) ? manifest.connector.reads : []
}

/** One declared read, or null when the connector declares none with that method. */
export function readByMethod(manifest, method) {
  return declaredReads(manifest).find((read) => read?.method === method) ?? null
}

/** The templates a manifest ships (§9.4). */
export function templatesOf(manifest) {
  return Array.isArray(manifest?.templates) ? manifest.templates : []
}

/** The template with this id, or null. */
export function templateById(manifest, id) {
  return templatesOf(manifest).find((template) => template?.id === id) ?? null
}

/**
 * An account a grant's resource may bind to: the contract's `ACCOUNT_PATTERN`
 * within Memory's cap of 128 (src/sources.js holds the same grammar). A
 * wildcard, the separator `:` or empty is never one; a `/` is, because
 * `linear.activity` answers `<workspace uuid>/<user email>`.
 */
export function accountName(value) {
  if (typeof value !== "string" || !/^[^\s*?:\u0000-\u001f\u007f]{1,128}$/.test(value)) throw new TypeError("an account must be a plain account name")
  return value
}

/**
 * The exact grant set a running job holds (DESIGN §9.1 D): every grant of the
 * job's source, every grant of each read its steps name, and every grant of the
 * identity's owner-only call, with `{account}` bound.
 *
 * `suggestBy` is not in it, and can never be: it runs only at bind, in the probe
 * session. A read the job's steps do not name contributes no grant.
 *
 * @param {any} manifest
 * @param {{source: string, account: string, steps?: Array<{use?: string, call?: string}>}} input
 * @returns {Array<{action: string, resource: string}>}
 */
export function jobGrants(manifest, { source: sourceId, account, steps = [] }) {
  const source = (manifest?.sources ?? []).find((entry) => entry?.id === sourceId)
  if (!source) throw new TypeError(`the declaration has no source ${String(sourceId)}`)
  const bound = accountName(account)
  const out = new Map()
  const add = (grant) => {
    if (!grant || typeof grant.action !== "string" || typeof grant.resource !== "string") return
    const resource = grant.resource.replaceAll("{account}", bound)
    out.set(`${grant.action}\u0000${resource}`, { action: grant.action, resource })
  }
  for (const grant of Array.isArray(source.grants) ? source.grants : []) add(grant)
  for (const step of Array.isArray(steps) ? steps : []) {
    if (typeof step?.call !== "string") continue
    const read = readByMethod(manifest, step.call)
    if (!read) throw new TypeError(`the job's step calls ${String(step.call)}, which the declaration does not declare`)
    for (const grant of Array.isArray(read.grants) ? read.grants : []) add(grant)
  }
  const identity = identityFor(manifest, sourceId)
  for (const grant of Array.isArray(identity?.grants) ? identity.grants : []) add(grant)
  return [...out.values()]
}


/**
 * RFC 8785 canonical JSON for the values JSON.parse gives: object keys sorted
 * by UTF-16 code units, numbers and strings as ECMAScript serialises them.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJSON(value, depth = 0) {
  if (depth > MAX_CANONICAL_DEPTH) throw new TypeError(`canonical JSON is nested deeper than ${MAX_CANONICAL_DEPTH} levels`)
  if (value === null || typeof value === "boolean") return JSON.stringify(value)
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("canonical JSON needs finite numbers")
    return JSON.stringify(value)
  }
  if (typeof value === "string") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJSON(item, depth + 1)).join(",")}]`
  if (typeof value === "object") {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJSON(value[key], depth + 1)}`).join(",")}}`
  }
  throw new TypeError(`canonical JSON cannot hold a ${typeof value}`)
}

/** The digest Memory pins a declaration by: `sha256:` and the hex of its canonical JSON. */
export function manifestDigest(value) {
  return `sha256:${createHash("sha256").update(canonicalJSON(value), "utf8").digest("hex")}`
}

/**
 * A `sources` descriptor's hash: the contract's own (`descriptorHash` in the
 * source-contract package), which is `manifestDigest` over the same canonical
 * JSON. Every consumer computes it the same way, so a grant's hash means the
 * same thing in Memory, jelly and a plugin's CI.
 */
export function descriptorHash(value) {
  return manifestDigest(value)
}
