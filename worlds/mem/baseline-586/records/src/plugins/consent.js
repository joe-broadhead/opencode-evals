/**
 * Consent for plugin-declared sources (DESIGN-PLUGIN-MEMORY S2, §3): the
 * records service's side. The store (records/src/store.js) checks the role and
 * the personal space and opens the transaction; everything here runs on its
 * handle, inside that transaction.
 *
 * - **plugins.request** (bearer): the person asks to collect from a source a
 *   plugin declares. Nothing is read.
 * - **plugins.probe** (bearer, the person's collector): the signed-in account
 *   the owner-only call reported, the declaration's digest on disk, and the
 *   scope options. Failures back off (1 h, 6 h, then attention).
 * - **plugins.consent** (browser session only): the person confirms the
 *   account, the scope and the routines of one source. The consent pins the
 *   plugin id, package and source, records the snapshot and its limits, and
 *   makes the binding (`sources` row). On the same pin and account a consent
 *   needs no new probe (the "Allow" of a waiting change).
 * - **plugins.pause** (bearer: it narrows), **plugins.resume** (session).
 * - **plugins.flag** (bearer, the collector): it only narrows: the account
 *   changed, or the package serving the plugin changed.
 * - **applyReport**: every plugins.report classifies each consent's plugin
 *   against the consent (§3.3). A package or source change pauses it until a
 *   full confirmation; a Missing row never pauses or unpauses it.
 * - **checkIngest**: the consent of (source, account), never the payload,
 *   decides: its state, scope and kinds; and a binding made before plugins is
 *   refused once an installed plugin declares its source (§6.3).
 *
 * **A server row is not a trust root** (§3.2): anyone with Memory's credential
 * can report a plugin. The person's collector re-reads the declaration from
 * disk and checks its digest before every collection (src/plugins/verify.js);
 * what is stored here only displays, records what the person confirmed, and
 * narrows.
 */
import { RecordsError, conflict, forbidden, invalid, notFound } from "../errors.js"
import { classify, limitsOf, snapshotOf } from "./classify.js"
import { manifestDigest, validateManifest } from "./manifest.js"
import { bindingProblem } from "./legacy-sources.js"
import { anchorBinding } from "./history-import.js"
import { chosenHistoryDays, requestHistory } from "./history-window.js"
import { listedState } from "./seen.js"
import { isSourceName } from "../source-ids.js"
import { errorText } from "../text.js"

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
// A source id: a built-in name (a word), or a declared source's contract id (dotted, at most 64
// characters). One grammar, held by `check:copies` against src/source-ids.js.

// A binding's account: the contract's `ACCOUNT_PATTERN` within Memory's cap of 128, a `/` included (src/sources.js holds the same grammar).
const ACCOUNT = /^[^\s*?:\u0000-\u001f\u007f]{1,128}$/
const DIGEST = /^sha256:[0-9a-f]{64}$/
/**
 * The requests one space holds that the person still has to act on (the 0.13.1
 * review's L1 and re-check M2): any editor key can add a row, each row is probed
 * until it fails three times, and every row is listed - so the table needs a
 * bound. `requested`, `reported` and `attention` count, because each is still
 * waiting for the person or the collector. A `failed` request gave up: it does
 * not count, and it is removed after FAILED_TTL_MS.
 */
export const MAX_OPEN_REQUESTS = 32
/** The requests `plugins.list` answers beyond the ones a collector must act on: the newest. */
export const MAX_LISTED_REQUESTS = 100
/** How long a `failed` request is kept: one that gave up and was never asked again. */
export const FAILED_TTL_MS = 7 * 24 * 3_600_000
/** How long a `reported` request is kept before the person confirms it: they can ask again. */
export const REPORTED_TTL_MS = 30 * 24 * 3_600_000
const COUNTED_STATES = "'requested', 'reported', 'attention'"
const BACKOFF_MS = Object.freeze([3_600_000, 6 * 3_600_000])
const MAX_FAILURES = 3
const MAX_OPTIONS = 200
/** The states a flag may set: each only narrows. */
const FLAGS = Object.freeze(["account_changed", "package_changed"])
const CONSOLE_NEXT = "The person opens Memory's console, Sources, signed in in a browser, and confirms it there."

/** The one bind rule: a retired alias, or a second name for an account already bound or requested (review F1). */
function refuseBinding(handle, { source, account }) {
  const problem = bindingProblem(handle, { source, account })
  if (problem) throw conflict(problem.code, problem.message, problem.next)
}

function parse(text, fallback) {
  if (text === null || text === undefined) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value)

/** The refusal of a method only a browser session of the console may call. */
export function sessionRequired(what) {
  return new RecordsError(403, "session_required", `${what} is the person's own act, in a browser, in Memory's console (Sources), not with a key or an agent's token.`, CONSOLE_NEXT)
}

function keyOf(body, method) {
  if (!isObject(body)) throw invalid("invalid_request", `${method} takes an object.`, "Send {plugin_id, source, account}.")
  const source = String(body.source ?? "")
  if (!isSourceName(source)) throw invalid("invalid_source", "source must be a source id the plugin declares, such as slack.", "Send the source id from plugins.list.")
  const account = body.account === undefined || body.account === null || body.account === "" ? "default" : String(body.account)
  if (!ACCOUNT.test(account)) throw invalid("invalid_source", "account must be the contract's name: no space, no wildcard (* or ?), no separator (:) and no control character, at most 128 characters - a / is allowed, as linear.activity names its account.", 'Send the account the source reported, or leave it out for "default".')
  return { source, account }
}

function pluginIdOf(body) {
  const id = String(body?.plugin_id ?? "")
  if (!PLUGIN_ID.test(id)) throw invalid("invalid_request", "plugin_id must be a plugin id such as slack.workspace.", "Send the plugin id from plugins.list.")
  return id
}

// ---------------------------------------------------------------------------
// The operator's deny list.

function glob(pattern, value) {
  const expression = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*").replaceAll("?", ".")
  return new RegExp(`^${expression}$`).test(value)
}

/** RECORDS_PLUGIN_DENY: comma-separated globs over plugin ids and package names. Read at each call. */
export function deniedBy(pluginId, packageName) {
  const patterns = String(process.env.RECORDS_PLUGIN_DENY ?? "").split(",").map((item) => item.trim()).filter(Boolean)
  return patterns.find((pattern) => glob(pattern, pluginId) || (packageName && glob(pattern, packageName))) ?? null
}

function refuseDenied(pluginId, packageName) {
  if (deniedBy(pluginId, packageName)) {
    throw new RecordsError(403, "plugin_denied", `The operator turned off ${pluginId} on this server (RECORDS_PLUGIN_DENY).`, "Ask the server's operator; nothing is collected from it until they allow it.")
  }
}

// ---------------------------------------------------------------------------
// Rows.

/**
 * A plugin's stored row. `state` is what the last report said of it, at any
 * age, and every safety check reads that. `offered` is the state it is on offer
 * with: `missing` when no report has listed it for PLUGIN_MISSING_AFTER_MS
 * (records/src/plugins/seen.js). Only "can it be turned on" reads `offered`.
 */
function pluginRow(handle, id, nowMs = Number.NaN) {
  const row = handle.get("select * from plugins where plugin_id = ?", id)
  if (!row) return null
  return { ...row, offered: listedState(row, nowMs), manifest: parse(row.manifest_json, null) }
}

function declaredSource(row, source) {
  const manifest = row?.manifest
  if (!manifest) return null
  // The current contract stores its descriptor as { contract: "sources", descriptor, hash }.
  if (manifest.contract === "sources") return manifest.descriptor?.items?.find?.((entry) => entry.id === source) ?? null
  return manifest.sources?.find?.((entry) => entry.id === source) ?? null
}

/** True when the plugin a row holds declares under the current contract (a `sources` descriptor). */
function declaresSources(row) {
  return row?.manifest?.contract === "sources"
}

/** The kind a declared source is (`events`, `snapshot`), or null when no declaration names it. */
export function declaredKind(handle, source) {
  for (const row of handle.all("select plugin_id, package_name, manifest_json from plugins where state in ('available', 'conflict') and manifest_json is not null")) {
    const item = declaredSource(row, source)
    if (item) return typeof item.kind === "string" ? item.kind : null
  }
  return null
}

/** The ids of the sources a reported plugin declares, under either contract. */
function declaredIds(row) {
  const manifest = parse(row?.manifest_json, null)
  if (!manifest) return []
  if (manifest.contract === "sources") return (manifest.descriptor?.items ?? []).map((item) => item.id)
  return (manifest.sources ?? []).map((item) => item.id)
}

/** The available plugins that declare `source`, with the package each is. */
function declaringPlugins(handle, source) {
  return handle
    .all("select plugin_id, package_name, manifest_json from plugins where state in ('available', 'conflict') and manifest_json is not null")
    .filter((row) => declaredIds(row).includes(source))
}

/**
 * C1 of the collector-binds audit: the refusal of the previous contract's
 * `sources.request` and `sources.bind` for a source an installed plugin
 * declares. It is **refused, never rerouted**: a rerouted call would record a
 * consent the person was never shown - no `private`, no cost and no scope -
 * and `checkIngest` refuses the page anyway, so the binding is a dead end.
 * The declared path is `plugins.request` then `plugins.consent`, in the console.
 *
 * @returns {{code: string, message: string, next: string} | null}
 */
export function declaredSourceRefusal(handle, { source }) {
  const declaring = declaringPlugins(handle, source)
  if (declaring.length === 0) return null
  const who = declaring.map((row) => `${row.package_name ?? row.plugin_id} (${row.plugin_id})`).join(", ")
  return {
    code: "plugin_consent_required",
    message: `${source} is declared by the installed plugin ${who}, so it is asked for and confirmed through that plugin: the previous contract's request or bind would make a consent nobody was shown, with no private, cost or scope. Nothing was changed.`,
    next: "Turn it on in Memory's console, Sources.",
  }
}

function requestRow(row) {
  if (!row) return null
  return {
    plugin_id: row.plugin_id,
    source: row.source,
    account: row.account,
    state: row.state,
    requested_by: row.requested_by,
    requested_at: row.requested_at,
    owner: row.owner_id ? { id: row.owner_id, label: row.owner_label ?? row.owner_id } : null,
    reported_account: row.reported_account ?? null,
    digest: row.digest ?? null,
    scope_options: parse(row.scope_options, null),
    // The window Memory would also read at the bind (lane 0195), so the consent can name it.
    history: requestHistory(row.source),
    // A request's note is the source's or the plugin's own sentence, and a row
    // stored before 0.11's fix may hold it raw: redacted as it is answered
    // (0.11 review, Check 2: redact on read, no sweep).
    note: typeof row.note === "string" ? errorText(row.note, 500) : (row.note ?? null),
    failures: Number(row.failures) || 0,
    retry_at: row.retry_at ?? null,
    reported_at: row.reported_at ?? null,
  }
}

function consentRow(handle, row) {
  if (!row) return null
  return {
    plugin_id: row.plugin_id,
    source: row.source,
    account: row.account,
    package: row.package_name,
    pin: { kind: row.source_kind, ref: row.source_ref },
    version: row.version ?? null,
    digest: row.digest,
    live_digest: row.live_digest ?? null,
    snapshot: parse(row.snapshot_json, null),
    limits: parse(row.limits_json, null),
    scope: parse(row.scope_json, {}),
    owner: { id: row.owner_id, label: row.owner_label ?? row.owner_id },
    state: row.state,
    pause_code: row.pause_code ?? null,
    declaration_changed: Number(row.declaration_changed ?? 0) === 1,
    // A pause's or a flag's reason is a source's failure text, and a row stored
    // before the fix may hold it raw: redacted as it is answered (same review).
    reason: typeof row.reason === "string" ? errorText(row.reason, 300) : (row.reason ?? null),
    consented_at: row.consented_at,
    consented_via: row.consented_via,
    updated: row.updated,
    pending: handle.all("select class, what, digest, created from plugin_pending where source = ? and account = ? order by seq", row.source, row.account),
    changes: handle.all("select class, what, from_digest, to_digest, at from plugin_changes where source = ? and account = ? order by seq desc limit 20", row.source, row.account),
  }
}

// ---------------------------------------------------------------------------
// plugins.request / plugins.probe

/**
 * Remove the requests nobody can act on any more (re-check M2): a `failed` one
 * after FAILED_TTL_MS - it gave up and was never asked again - and a `reported`
 * one after REPORTED_TTL_MS - the person never confirmed it. `attention` is the
 * person's to cancel or re-ask, so it stays.
 */
function sweepRequests(handle, nowMs) {
  const failed = new Date(nowMs - FAILED_TTL_MS).toISOString()
  const reported = new Date(nowMs - REPORTED_TTL_MS).toISOString()
  handle.run("delete from plugin_requests where state = 'failed' and requested_at < ?", failed)
  handle.run("delete from plugin_requests where state = 'reported' and requested_at < ?", reported)
}

/**
 * plugins.cancel: the person ends a request they no longer need (re-check M2). It
 * is theirs: a browser session, or the person's own key, and never another
 * person's row. Nothing was bound by a request, so nothing else changes.
 */
export function cancelPlugin({ handle, actor }, body) {
  const id = pluginIdOf(body)
  const { source, account } = keyOf(body, "plugins.cancel")
  const row = handle.get("select * from plugin_requests where source = ? and account = ?", source, account)
  if (!row) throw new RecordsError(404, "request_not_found", `No request to collect from ${source} (${account}) waits in this space.`, "Cancel a request plugins.list returns.")
  if (row.requested_by !== actor.user) throw forbidden("Only the person who asked can cancel this request.", "Ask from your own personal space, or cancel one you asked for.")
  if (row.plugin_id !== id) throw conflict("plugin_not_reported", `The request for ${source} (${account}) is for ${row.plugin_id}, not ${id}.`, "Cancel the plugin the request names.")
  handle.run("delete from plugin_requests where source = ? and account = ?", source, account)
  return { cancelled: true }
}

/** plugins.request: the person asks to collect from a declared source. Nothing is read here. */
export function requestPlugin({ handle, actor, nowIso, nowMs }, body) {
  const id = pluginIdOf(body)
  const { source, account } = keyOf(body, "plugins.request")
  const row = pluginRow(handle, id, Number.isFinite(nowMs) ? nowMs : Date.parse(nowIso))
  refuseDenied(id, row?.package_name)
  if (!row || row.offered !== "available") throw conflict("plugin_unavailable", `${id} is not available to collect from (${row ? row.offered : "not reported"}).`, "Check Sources in Memory's console: the plugin must be installed, valid and verified.")
  // The one-binding rule answers for a retired alias before the declaration is
  // consulted: the alias is no longer declared, and the refusal that names the
  // declared source is the useful one.
  refuseBinding(handle, { source, account })
  const item = declaredSource(row, source)
  if (!item) throw invalid("invalid_source", `${id} declares no source ${source}.`, "Ask for a source plugins.list shows under that plugin.")
  // Only a contract-v1 descriptor item has a `kind`; a v2 `manifest.sources` entry
  // declares `kinds` and is left alone.
  if (declaresSources(row) && item.kind !== "events") throw conflict("source_kind", `${source} is a ${String(item.kind)} source, and this release collects events sources only.`, "Nothing was requested. Its plugin stays installed; it is not offered until Memory reads this kind of source.")
  const consent = handle.get("select state, plugin_id from plugin_consents where source = ? and account = ?", source, account)
  if (consent?.state === "on" && consent.plugin_id === id) throw conflict("already_bound", `${source} (${account}) is already collecting.`, "Pause or unbind it first to change the account.")
  // The table has a bound (0.13.1 review L1, re-check M2): an editor key may ask,
  // and every open request is probed and listed. A request that gave up leaves
  // after a week, and one reported and never confirmed after a month, so the
  // space can never fill with rows the person cannot act on.
  sweepRequests(handle, Number.isFinite(nowMs) ? nowMs : Date.parse(nowIso))
  const waits = handle.get("select 1 as waiting from plugin_requests where source = ? and account = ?", source, account)
  if (!waits) {
    const open = handle.get(`select count(*) as n from plugin_requests where state in (${COUNTED_STATES})`)?.n ?? 0
    if (Number(open) >= MAX_OPEN_REQUESTS) {
      throw conflict("request_limit", `${MAX_OPEN_REQUESTS} plugin requests already wait in this space, so ${source} (${account}) was not asked for.`, "Cancel a request you no longer need in Memory's console, Sources, then ask again.")
    }
  }
  handle.run(
    `insert into plugin_requests (source, account, plugin_id, requested_by, requested_at, state, failures)
     values (?, ?, ?, ?, ?, 'requested', 0)
     on conflict(source, account) do update set plugin_id = excluded.plugin_id, requested_by = excluded.requested_by, requested_at = excluded.requested_at,
       state = 'requested', failures = 0, owner_id = null, owner_label = null, reported_account = null, digest = null, scope_options = null, note = null, retry_at = null, reported_at = null`,
    source,
    account,
    id,
    actor.user,
    nowIso,
  )
  return { request: requestRow(handle.get("select * from plugin_requests where source = ? and account = ?", source, account)) }
}

/**
 * The scope keys a declaration names. A contract-v1 descriptor declares
 * `scope: {keys: ["calendars"], describe}` - a list of names - and a v2
 * manifest entry declares a list of `{key, title, ...}` entries. Reading the
 * first as the second was a 500: `(declared.scope ?? []).map is not a function`
 * (lane 0142's review, 2026-11-18).
 */
function declaredScopeKeys(declared) {
  const scope = declared?.scope
  if (Array.isArray(scope)) return new Set(scope.map((entry) => entry?.key).filter((key) => typeof key === "string"))
  if (Array.isArray(scope?.keys)) return new Set(scope.keys.filter((key) => typeof key === "string"))
  return new Set()
}

function scopeOptions(value, declared) {
  if (value === undefined || value === null) return null
  const keys = declaredScopeKeys(declared)
  if (!isObject(value)) throw invalid("invalid_scope", "scope_options must be {<key>: [{id, label}]}.", "Send the options the owner-only call returned.")
  const out = {}
  for (const [key, options] of Object.entries(value)) {
    if (!keys.has(key)) throw invalid("invalid_scope", `scope_options names a key the source does not declare.`, "Send only the declared scope keys.")
    if (!Array.isArray(options) || options.length > MAX_OPTIONS) throw invalid("invalid_scope", `scope_options.${key} must be a list of at most ${MAX_OPTIONS}.`, "Send the first options.")
    out[key] = options.map((option) => {
      if (!isObject(option) || typeof option.id !== "string" || option.id.length === 0 || option.id.length > 200) throw invalid("invalid_scope", `a scope option of ${key} needs an id of at most 200 characters.`, "Send {id, label}.")
      return { id: option.id, label: String(option.label ?? option.id).replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 200) }
    })
  }
  return out
}

/** plugins.probe: the collector's answer to a request: the account and the declaration it read, or why not. */
export function probePlugin({ handle, actor, nowIso, nowMs }, body) {
  const id = pluginIdOf(body)
  const { source, account } = keyOf(body, "plugins.probe")
  const request = handle.get("select * from plugin_requests where source = ? and account = ?", source, account)
  if (!request) throw notFound(`Nobody asked to collect from ${source} (${account}) in this space.`, "Report only on a request plugins.list returns.")
  if (request.requested_by !== actor.user) throw forbidden("Only the person who asked can report on this request.", "The person's own collector reports on their requests.")
  if (request.plugin_id !== id) throw conflict("plugin_not_reported", `The request for ${source} (${account}) is for ${request.plugin_id}, not ${id}.`, "Report the plugin the request names.")
  const digest = body.digest === undefined || body.digest === null ? null : String(body.digest)
  if (digest !== null && !DIGEST.test(digest)) throw invalid("invalid_request", "digest must be sha256:<hex>.", "Send the digest of the declaration read from disk.")
  const declared = declaredSource(pluginRow(handle, id), source)
  const options = declared ? scopeOptions(body.scope_options, declared) : null
  const owner = isObject(body.owner) && typeof body.owner.id === "string" && body.owner.id && body.owner.id.length <= 300 ? { id: body.owner.id, label: String(body.owner.label ?? body.owner.id).slice(0, 300) } : null
  const reported = owner && typeof body.reported_account === "string" && ACCOUNT.test(body.reported_account) ? body.reported_account : account
  const note = body.note === undefined || body.note === null ? null : String(body.note).replace(/\s+/g, " ").trim().slice(0, 500)
  const failures = owner ? 0 : (Number(request.failures) || 0) + 1
  const state = owner ? "reported" : failures >= MAX_FAILURES ? "attention" : "failed"
  const retryAt = state === "failed" ? new Date(nowMs + BACKOFF_MS[failures - 1]).toISOString() : null
  handle.run(
    "update plugin_requests set state = ?, owner_id = ?, owner_label = ?, reported_account = ?, digest = ?, scope_options = ?, note = ?, failures = ?, retry_at = ?, reported_at = ? where source = ? and account = ?",
    state,
    owner?.id ?? null,
    owner?.label ?? null,
    owner ? reported : null,
    digest,
    options ? JSON.stringify(options) : null,
    note,
    failures,
    retryAt,
    nowIso,
    source,
    account,
  )
  return { request: requestRow(handle.get("select * from plugin_requests where source = ? and account = ?", source, account)) }
}

/**
 * plugins.reconfirm (N1): the person confirms a **bound** source again, after the
 * declaration changed. It shows the declaration installed now — its digest and
 * its scope keys — and, on `confirm`, records exactly that digest and the scope
 * the person chose, turning the consent back on.
 *
 * Three rules keep it honest:
 * - it records only the digest the dialog **showed** (compare-and-set): a
 *   declaration that moved between the dialog and the click is `plugin_changed`,
 *   "The source changed again; review it again."
 * - it clears only a **declaration-change** rebind (`package_changed`, or
 *   `needs_rebind` whose cause was `DECLARATION_CHANGED`). An owner or account
 *   change needs a proper rebind, and stays paused.
 * - it records the declaration's snapshot afresh, so what the person confirmed is
 *   what the console shows.
 * - it records the package pin that is installed (`source_ref`, with the package
 *   and the kind), so the next report compares with what the person confirmed. A
 *   new pin of the same package is confirmable; a different package or kind is
 *   `rebind_required`, a new trust decision. The preview names both pins.
 */
export function reconfirmPlugin({ handle, actor, nowIso }, body) {
  const id = pluginIdOf(body)
  const { source, account } = keyOf(body, "plugins.reconfirm")
  const row = pluginRow(handle, id, Date.parse(nowIso))
  refuseDenied(id, row?.package_name)
  if (!row || row.offered !== "available") throw conflict("plugin_unavailable", `${id} is not available to collect from (${row ? row.offered : "not installed"}).`, "Check Sources in Memory's console.")
  if (!declaresSources(row)) throw invalid("invalid_source", `${id} carries no sources declaration to confirm again.`, "Confirm a plugin source the console lists.")
  const item = declaredSource(row, source)
  if (!item) throw invalid("invalid_source", `${id} declares no source ${source}.`, "Confirm a source plugins.list shows under that plugin.")
  const consent = handle.get("select * from plugin_consents where source = ? and account = ? and plugin_id = ?", source, account, id)
  if (!consent) throw notFound(`${source} (${account}) is not bound to ${id}.`, "Bind it first, then confirm it again when it asks.")
  const declarationChange = consent.state === "package_changed" || (consent.state === "needs_rebind" && (Number(consent.declaration_changed ?? 0) === 1 || consent.pause_code === "DECLARATION_CHANGED"))
  if (!declarationChange) {
    throw conflict(
      "rebind_required",
      `${source} (${account}) needs its account confirmed again, not its declaration.`,
      "Choose Bind… and confirm the account it reports; a declaration confirmation cannot clear an owner or account change.",
    )
  }
  // A new pin of the same package is the person's to confirm again. A different package, or a different kind of
  // source, is a new trust decision: it is bound again, never confirmed again.
  if (row.package_name !== consent.package_name || row.source_kind !== consent.source_kind) {
    throw conflict(
      "rebind_required",
      `${source}: a different package serves this source; bind it again.`,
      "Choose Bind… and confirm the package and the account it reports; a declaration confirmation cannot trust a different package.",
    )
  }
  const scope = checkSourceScope(body.scope === undefined ? parse(consent.scope_json, {}) : body.scope, item)
  const preview = {
    action: "reconfirm",
    source,
    account,
    plugin_id: id,
    label: String(item.id ?? source).slice(0, 120),
    digest: row.digest,
    version: row.version ?? consent.version ?? null,
    // The package pin: what the person confirmed before, and what is installed now.
    package: row.package_name,
    source_ref_was: consent.source_ref ?? null,
    source_ref: row.source_ref ?? null,
    // The declaration installed now: the keys and values the person confirms.
    scope_keys: Array.isArray(item.scope?.keys) ? item.scope.keys : [],
    scope_options: parse(consent.scope_json, {}),
    scope,
    state: consent.state,
  }
  if (body.confirm !== true) return { preview }
  if (actor.credential !== "session") throw new sessionRequired("Confirming a plugin source again")
  // Compare-and-set: only the declaration the person was shown may be recorded.
  const shown = body.digest === undefined || body.digest === null ? "" : String(body.digest)
  if (!DIGEST.test(shown) || shown !== row.digest) {
    throw conflict("plugin_changed", "The source changed again; review it again.", "Reload Sources in Memory's console and confirm what it shows now.")
  }
  const snapshot = {
    contract: "sources",
    source: item,
    private: item.private === true,
    scopeDescribe: typeof item.scope?.describe === "string" ? item.scope.describe : null,
    cost: item.cost ?? { class: "free" },
    cadence: { providerMinMinutes: Number(item.cadence?.providerMinMinutes) || null },
    scopeKeys: item.scope?.keys ?? [],
    details: item.details ?? [],
    maxBytes: item.maxBytes ?? 65536,
    descriptorHash: shown,
  }
  // Only the declaration half clears (N4a): an owner or account cause stays, and with it the binding.
  const ownerCause = consent.pause_code === "OWNER_CHANGED" || consent.pause_code === "ACCOUNT_MISMATCH" || consent.pause_code === "ACCOUNT_UNKNOWN"
  handle.run(
    "update plugin_consents set package_name = ?, source_kind = ?, source_ref = ?, digest = ?, live_digest = ?, version = ?, snapshot_json = ?, scope_json = ?, state = ?, reason = ?, pause_code = ?, declaration_changed = 0, consented_at = coalesce(?, consented_at), consented_via = coalesce(?, consented_via), consented_by = coalesce(?, consented_by), updated = ? where source = ? and account = ? and plugin_id = ?",
    // The pin that is installed and was shown: the next report compares against it, so the confirmation holds.
    row.package_name,
    row.source_kind,
    row.source_ref,
    shown,
    shown,
    row.version ?? consent.version ?? null,
    JSON.stringify(snapshot),
    JSON.stringify(scope),
    ownerCause ? "needs_rebind" : "on",
    ownerCause ? "the account changed; the person confirms it again" : null,
    ownerCause ? consent.pause_code : null,
    // The latest confirmation: when, how and by whom, recorded only when this turns the consent on. An owner or
    // account cause stays, so the account is still unconfirmed and the earlier values stand (null keeps a column).
    // `sources.confirmed_at` is the bind's and stays, because the engine's lane rule opens its backfill window from it.
    ownerCause ? null : nowIso,
    ownerCause ? null : "session",
    ownerCause ? null : actor.user,
    nowIso,
    source,
    account,
    id,
  )
  return { consent: consentRow(handle, handle.get("select * from plugin_consents where source = ? and account = ?", source, account)) }
}

// ---------------------------------------------------------------------------
// plugins.consent

function checkScope(value, declared, options) {
  // A v2 manifest entry declares its scope as a list of `{key, title, max, pattern}`
  // entries, and this path is that contract's: the entries are what it needs.
  const entries = Array.isArray(declared?.scope) ? declared.scope : []
  const keys = new Map(entries.map((entry) => [entry.key, entry]))
  const scope = value === undefined || value === null ? {} : value
  if (!isObject(scope)) throw invalid("invalid_scope", "scope must be {<key>: [ids]}.", "Send the ids the person picked.")
  const out = {}
  for (const [key, ids] of Object.entries(scope)) {
    const entry = keys.get(key)
    if (!entry) throw invalid("invalid_scope", "scope names a key the source does not declare.", "Send only the declared scope keys.")
    if (!Array.isArray(ids) || ids.length > entry.max) throw invalid("invalid_scope", `scope.${key} takes at most ${entry.max} ids.`, "Pick fewer.")
    const pattern = new RegExp(entry.pattern, "u")
    for (const item of ids) {
      if (typeof item !== "string" || !pattern.test(item)) throw invalid("invalid_scope", `a scope.${key} id does not match the declared pattern.`, "Pick from the options the source offered.")
      if (options?.[key] && !options[key].some((option) => option.id === item)) throw invalid("invalid_scope", `a scope.${key} id is not one the source offered.`, "Pick from the options the source offered.")
    }
    if (ids.length) out[key] = [...new Set(ids)]
  }
  for (const entry of entries) if (entry.required && !out[entry.key]?.length) throw invalid("invalid_scope", `scope.${entry.key} is required.`, `Pick at least one ${entry.title}.`)
  return out
}

/**
 * Which accounts a declared source may bind (§15.4): the default always, and a
 * named one only when the declaration covers it. A declaration whose
 * operations name no account (`slack_events_list`, `gws.read`) resolves the
 * account at call time, so any account it reports binds; one that names its
 * per-account reads (`plaud-<alias>_*`) binds only the accounts it names.
 * Nothing is bound that the declaration cannot grant.
 *
 * @returns {string | null} the sentence to refuse with, or null
 */
function accountProblem(item, source, account) {
  if (!account || account === "default") return null
  // A per-account read is the plugin's own tool with the account's alias in its
  // name (`plaud-alias1_list`): a dash in the prefix before the first `_`. A
  // namespaced read (`slack_events_list`) is not one, and resolves the account
  // at call time instead.
  const operations = Array.isArray(item?.permission?.operations) ? item.permission.operations : []
  const accountNamed = item?.accounts?.named === true ? operations.filter((operation) => /^[a-z][a-z0-9]*-[a-z0-9.-]+_/.test(operation)) : []
  if (accountNamed.length === 0) return null
  // The alias is everything after the plugin's prefix and the first dash:
  // `plaud-work-2_list` names the account `work-2`, and `plaud-a.b_list` names
  // `a.b`. Splitting on every dash turned `work-2` into `2`, so a declared
  // account refused itself and bound another (B4).
  const alias = (operation) => {
    const prefix = operation.slice(0, operation.indexOf("_"))
    return prefix.slice(prefix.indexOf("-") + 1)
  }
  if (accountNamed.some((operation) => alias(operation) === account)) return null
  return `${source} names no read for the account "${account}": its declaration declares ${[...new Set(accountNamed.map(alias))].join(", ")} only. Next step: pick the default account, or ask the plugin to declare ${account}.`
}

/**
 * plugins.consent: the person's confirmation, from a browser session (the
 * store checks the session and the personal space). It needs the person's
 * reported request, or an existing consent on the same pin and account.
 */
export function consentPlugin({ handle, actor, nowIso }, body) {
  const id = pluginIdOf(body)
  const { source, account } = keyOf(body, "plugins.consent")
  const row = pluginRow(handle, id, Date.parse(nowIso))
  refuseDenied(id, row?.package_name)
  const digest = String(body.digest ?? "")
  const declaredItem = declaredSource(row, source)
  // **A source that reads one account is keyed by the account its probe reported**
  // (G2): `history.sessions` reports the machine it indexed and `linear.activity`
  // the workspace's user, and the page is accepted only against that account
  // (`acceptAnswer` compares it with the grant's). The request is kept under the
  // account the person asked with ("default"); the consent and the binding take
  // the reported one, and the console's confirm already sends it.
  // `accounts.named` is a contract-v1 descriptor's word; a v2 `manifest.sources`
  // entry declares `accounts: "multi"` and is left on the account it asked with.
  const single = declaresSources(row) && declaredItem !== null && declaredItem.accounts?.named !== true
  const asked = handle.get("select * from plugin_requests where source = ? and account = ?", source, account)
  const request = asked ?? (single ? handle.get("select * from plugin_requests where source = ? order by requested_at desc limit 1", source) ?? null : null)
  const key = single && typeof request?.reported_account === "string" && request.reported_account ? request.reported_account : account
  const existing = handle.get("select * from plugin_consents where source = ? and account = ?", source, key)
  refuseBinding(handle, { source, account: key })
  let owner
  let options = null
  if (request && request.state === "reported") {
    if (request.requested_by !== actor.user) throw forbidden("Only the person who asked to collect from this source can confirm it.", CONSOLE_NEXT)
    if (request.plugin_id !== id) throw conflict("plugin_not_reported", `Your collector reported ${source} (${account}) for ${request.plugin_id}, not ${id}.`, "Confirm the plugin the request names.")
    owner = { id: request.owner_id, label: request.owner_label ?? request.owner_id }
    if (String(body.owner_id ?? "") !== owner.id) throw new RecordsError(403, "owner_mismatch", `${source} (${account}) reported ${owner.label}: a consent confirms only the account the collector reported.`, "Reload Sources in Memory's console and confirm the account it shows.")
    if (request.digest !== digest) throw conflict("plugin_changed", "The declaration your collector read differs from the one you are confirming.", "Reload Sources in Memory's console and confirm what it shows now.")
    options = parse(request.scope_options, null)
  } else if (existing && existing.plugin_id === id && (existing.state === "on" || existing.state === "paused") && row && row.package_name === existing.package_name && row.source_kind === existing.source_kind && row.source_ref === existing.source_ref) {
    // The same pin and account: allowing a waiting change needs no new probe.
    owner = { id: existing.owner_id, label: existing.owner_label ?? existing.owner_id }
    if (String(body.owner_id ?? "") !== owner.id) throw new RecordsError(403, "owner_mismatch", `${source} (${account}) collects from ${owner.label}.`, "Reload Sources in Memory's console and confirm the account it shows.")
  } else {
    throw conflict("plugin_not_reported", `Your collector has not reported which account ${source} (${account}) is signed in to for ${id}.`, "Choose Turn on… for this source in Memory's console; your collector reports the account on its next run, then confirm it.")
  }
  if (!row || row.offered !== "available") throw conflict("plugin_unavailable", `${id} is not available to collect from (${row ? row.offered : "not installed"}).`, "Check Sources in Memory's console.")
  // **Only an events source is collected in this release** (G1): a snapshot source
  // is declared, and nothing reads it (`src/collector.js` collects `kind:
  // "events"`), so binding one would promise records that never arrive.
  if (declaresSources(row) && declaredItem && declaredItem.kind !== "events") {
    throw conflict("source_kind", `${source} is a ${String(declaredItem.kind)} source, and this release collects events sources only.`, "Nothing was changed. Its plugin stays installed; it is not offered until Memory reads this kind of source.")
  }
  if (declaresSources(row)) {
    // The current contract: the descriptor's hash is what the person confirms,
    // and the consent records what the console showed — `private`, the cost
    // units and the scope keys.
    const item = declaredSource(row, source)
    if (!item) throw invalid("invalid_source", `${id} declares no source ${source}.`, "Confirm a source plugins.list shows under that plugin.")
    if (row.digest !== digest) throw conflict("plugin_changed", "The declaration changed since you looked.", "Reload Sources in Memory's console and confirm what it shows now.")
    const problem = accountProblem(item, source, key)
    if (problem) throw invalid("invalid_account", problem, "Bind only an account the declaration names; the default always binds.")
    const scope = checkSourceScope(body.scope, item)
    // **A re-keyed binding supersedes the one it replaces** (S3): when the same
    // source is confirmed again because its probe now reports another account (an
    // X handle switch), the old binding stops collecting and says so. Its records
    // stay. The asked account is kept beside the reported one, so a person two
    // explicit accounts are never superseded by each other.
    if (single && key !== account) {
      for (const stale of handle.all("select source, account, snapshot_json from plugin_consents where source = ? and account <> ?", source, key)) {
        if (parse(stale.snapshot_json, null)?.asked_account !== account) continue
        handle.run("update sources set status = 'superseded', enabled = 0, updated = ? where source = ? and account = ?", nowIso, source, stale.account)
        handle.run(
          "update plugin_consents set state = 'paused', reason = ?, updated = ? where source = ? and account = ?",
          `superseded: this source now reads ${key}`.slice(0, 200),
          nowIso,
          source,
          stale.account,
        )
      }
    }
    const snapshot = {
      contract: "sources",
      source: item,
      ...(single && key !== account ? { asked_account: account } : {}),
      private: item.private === true,
      // What the person is shown (§15.5): the source's own sentence about what
      // it reads, its price units and its probe's own price, and the cadence it
      // declares — so the consent says what is read and what it costs.
      scopeDescribe: typeof item.scope?.describe === "string" ? item.scope.describe : null,
      cost: item.cost ?? { class: "free" },
      cadence: { providerMinMinutes: Number(item.cadence?.providerMinMinutes) || null },
      scopeKeys: item.scope?.keys ?? [],
      details: item.details ?? [],
      maxBytes: item.maxBytes ?? 65536,
      descriptorHash: digest,
    }
    recordConsent(handle, { actor, nowIso }, { id, row, source, account: key, requested: account, owner, digest, snapshot, limits: null, scope, lookback: chosenHistoryDays(body.lookback_days, source) })
    return { consent: consentRow(handle, handle.get("select * from plugin_consents where source = ? and account = ?", source, key)) }
  }
  if (row.digest !== digest || !row.manifest || !validateManifest(row.manifest).ok || manifestDigest(row.manifest) !== digest) {
    throw conflict("plugin_changed", "The declaration changed since you looked.", "Reload Sources in Memory's console and confirm what it shows now.")
  }
  const enabled = body.routines === undefined ? [] : body.routines
  const snapshot = snapshotOf(row.manifest, source, { enabled: Array.isArray(enabled) ? enabled : [] })
  if (!snapshot) throw invalid("invalid_source", `${id} declares no source ${source}.`, "Confirm a source plugins.list shows under that plugin.")
  if (!Array.isArray(enabled) || !enabled.every((routine) => snapshot.routines.some((entry) => entry.id === routine))) throw invalid("invalid_routines", "routines must name routines of this source.", "Send the ids plugins.list shows.")
  // extract routines stay off until their precision check passes (§4.4; S3).
  if (snapshot.routines.some((routine) => routine.enabled && routine.engine === "extract")) throw invalid("invalid_routines", "Routines that propose memories stay off until their precision check passes.", "Turn on render routines only for now.")
  const scope = checkScope(body.scope, snapshot.source, options)
  const limits = limitsOf(snapshot)
  return recordConsent(handle, { actor, nowIso }, { id, row, source, account, owner, digest, snapshot, limits, scope, lookback: chosenHistoryDays(body.lookback_days, source) })
}

/** Record a confirmation: the consent row, its pending set cleared, and the binding every ingest and cursor path reads. */
function recordConsent(handle, { actor, nowIso }, { id, row, source, account, requested, owner, digest, snapshot, limits, scope, lookback = 0 }) {
  handle.run(
    `insert into plugin_consents (source, account, plugin_id, package_name, source_kind, source_ref, version, digest, live_digest, snapshot_json, limits_json, scope_json,
       owner_id, owner_label, state, reason, consented_at, consented_via, consented_by, updated)
     values (?, ?, ?, ?, ?, ?, ?, ?, null, ?, ?, ?, ?, ?, 'on', null, ?, 'session', ?, ?)
     on conflict(source, account) do update set plugin_id = excluded.plugin_id, package_name = excluded.package_name, source_kind = excluded.source_kind,
       source_ref = excluded.source_ref, version = excluded.version, digest = excluded.digest, live_digest = null, snapshot_json = excluded.snapshot_json,
       limits_json = excluded.limits_json, scope_json = excluded.scope_json, owner_id = excluded.owner_id, owner_label = excluded.owner_label, state = 'on',
       reason = null, pause_code = null, declaration_changed = 0, consented_at = excluded.consented_at, consented_via = 'session', consented_by = excluded.consented_by, updated = excluded.updated`,
    source,
    account,
    id,
    row.package_name,
    row.source_kind,
    row.source_ref,
    row.version ?? null,
    digest,
    JSON.stringify(snapshot),
    JSON.stringify(limits),
    JSON.stringify(scope),
    owner.id,
    owner.label,
    nowIso,
    actor.user,
    nowIso,
  )
  handle.run("delete from plugin_pending where source = ? and account = ?", source, account)
  // The request may sit under the account the person asked with, and the consent
  // under the one the probe reported (G2): clear both, never leaving a request
  // that would be reported a second time.
  handle.run("delete from plugin_requests where source = ? and account in (?, ?)", source, account, requested ?? account)
  // The binding: what the existing ingest, cursor and unbind paths read.
  handle.run(
    `insert into sources (source, account, owner_id, owner_label, status, confirmed_at, enabled, created, updated)
     values (?, ?, ?, ?, 'confirmed', ?, 1, ?, ?)
     on conflict(source, account) do update set owner_id = excluded.owner_id, owner_label = excluded.owner_label,
       status = 'confirmed', confirmed_at = excluded.confirmed_at, enabled = 1, updated = excluded.updated`,
    source,
    account,
    owner.id,
    owner.label,
    nowIso,
    nowIso,
    nowIso,
  )
  // The history the person agreed to read, anchored on the binding (lane 0195).
  anchorBinding(handle, { source, account, nowIso, days: lookback })
  return { consent: consentRow(handle, handle.get("select * from plugin_consents where source = ? and account = ?", source, account)) }
}

/**
 * A descriptor's scope as the person confirmed it: its `scope.keys`, each a
 * list of ids. A key the source does not declare is refused (it would widen
 * the read), and an id is text of at most 256 characters.
 *
 * @returns {Record<string, string[]>}
 */
function checkSourceScope(value, item) {
  const keys = new Set(item.scope?.keys ?? [])
  const scope = value === undefined || value === null ? {} : value
  if (!isObject(scope)) throw invalid("invalid_scope", "scope must be {<key>: [ids]}.", "Send the ids the person picked.")
  const out = {}
  for (const [key, ids] of Object.entries(scope)) {
    if (!keys.has(key)) throw invalid("invalid_scope", "scope names a key the source does not declare.", "Send only the declared scope keys.")
    if (!Array.isArray(ids) || ids.length > 64) throw invalid("invalid_scope", `scope.${key} takes at most 64 ids.`, "Pick fewer.")
    for (const id of ids) {
      if (typeof id !== "string" || id.length === 0 || id.length > 256) throw invalid("invalid_scope", `a scope.${key} id must be text of 1 to 256 characters.`, "Pick from the options the source offered.")
    }
    if (ids.length) out[key] = [...new Set(ids)]
  }
  return out
}

// ---------------------------------------------------------------------------
// Kill switches and flags.

/** plugins.pause: stop collecting from every source of a plugin, or from one binding. A bearer may: it only narrows. */
/**
 * Pause one **binding**: the source and account the person confirmed, without
 * touching that plugin's other sources. A binding that restarted its window
 * twice in one day pauses here (§9.3), and every job on it stops with the same
 * reason.
 *
 * @returns {number} the rows changed (0 when it was not on)
 */
export function pauseBinding(handle, { pluginId, source, account, reason, at, state = "paused", code = null }) {
  // A binding's causes are recorded apart (N4a): an **owner or account** change (`pause_code`) survives any later
  // pause or report, and a **declaration** change (`declaration_changed`) is the half a reconfirm clears. A
  // binding reads only when no cause remains, so neither cause may overwrite the other.
  const current = handle.get("select * from plugin_consents where plugin_id = ? and source = ? and account = ?", pluginId, source, account)
  if (!current) return 0
  const cause = code === null ? null : String(code).slice(0, 80)
  const ownerCause = cause === "OWNER_CHANGED" || cause === "ACCOUNT_MISMATCH" || cause === "ACCOUNT_UNKNOWN"
  const declarationCause = cause === "DECLARATION_CHANGED"
  // **`needs_rebind` takes precedence** (B3): a plain pause never turns it into a `paused` a later resume could
  // lift, and a declaration pause never clears the owner or account cause it sits beside.
  if (current.state === "needs_rebind" && !ownerCause) {
    if (declarationCause) {
      // The declaration half only: an owner cause already recorded stays, and the binding stays a rebind.
      if (current.pause_code) {
        return handle.run("update plugin_consents set declaration_changed = 1, updated = ? where plugin_id = ? and source = ? and account = ? and state = 'needs_rebind'", at, pluginId, source, account).changes
      }
      return handle.run(
        "update plugin_consents set state = 'package_changed', reason = ?, pause_code = NULL, declaration_changed = 1, updated = ? where plugin_id = ? and source = ? and account = ? and state = 'needs_rebind'",
        String(reason ?? "the declaration changed").slice(0, 200),
        at,
        pluginId,
        source,
        account,
      ).changes
    }
    handle.run("update plugin_consents set updated = ? where plugin_id = ? and source = ? and account = ? and state = 'needs_rebind'", at, pluginId, source, account)
    return 1
  }
  if (declarationCause) {
    if (current.pause_code) {
      return handle.run("update plugin_consents set declaration_changed = 1, updated = ? where plugin_id = ? and source = ? and account = ? and state = 'needs_rebind'", at, pluginId, source, account).changes
    }
    return handle.run(
      "update plugin_consents set state = 'package_changed', reason = ?, pause_code = NULL, declaration_changed = 1, updated = ? where plugin_id = ? and source = ? and account = ? and state in ('on', 'paused', 'access_refused', 'package_changed')",
      String(reason ?? "the declaration changed").slice(0, 200),
      at,
      pluginId,
      source,
      account,
    ).changes
  }
  if (ownerCause) {
    return handle.run(
      "update plugin_consents set state = 'needs_rebind', reason = ?, pause_code = ?, updated = ? where plugin_id = ? and source = ? and account = ? and state in ('on', 'needs_rebind', 'package_changed', 'access_refused', 'paused')",
      String(reason ?? "paused").slice(0, 200),
      cause,
      at,
      pluginId,
      source,
      account,
    ).changes
  }
  return handle.run(
    "update plugin_consents set state = ?, reason = ?, pause_code = NULL, updated = ? where plugin_id = ? and source = ? and account = ? and state in ('on', 'needs_rebind', 'access_refused', 'paused', 'package_changed')",
    state,
    String(reason ?? "paused").slice(0, 200),
    at,
    pluginId,
    source,
    account,
  ).changes
}

export function pausePlugin({ handle, nowIso }, body) {
  // One binding: the collector pauses the source and account the contract's
  // table stopped (§8.3.4), never that plugin's other sources.
  if (isObject(body) && body.source !== undefined) {
    const { source, account } = keyOf(body, "plugins.pause")
    const consent = handle.get("select plugin_id from plugin_consents where source = ? and account = ?", source, account)
    if (!consent) return { paused: 0 }
    // **A machine that does not collect the binding cannot pause it** (0.12.3):
    // the same rule as a collection failure (`sources.collected`). A guest
    // started from a snapshot has the person's Memory sign-in and none of the
    // source's, so its refusal would stop the machine that reads the source
    // from collecting at all. A binding whose collector is not known yet keeps
    // the older rule: its next pause is the binding's.
    const host = typeof body.host === "string" ? body.host.trim().toLowerCase().slice(0, 128) : ""
    const standing = handle.get("select host from source_collections where source = ? and account = ?", source, account)?.host ?? null
    if (host && standing && host !== standing) return { paused: 0, elsewhere: true }
    // A caller's own words (a host's collector): redacted on the way in as well
    // as on the way out, so this build never stores a secret (round 2).
    const reason = errorText(String(body.reason ?? "paused"), 200)
    // A binding the person must act on waits for a rebind, not a plain resume: the owner or account changed,
    // or the plugin no longer declares the source (v0.1.0's SOURCE_UNKNOWN), which a resume cannot bring back.
    const state =
      body.code === "OWNER_CHANGED" ||
      body.code === "ACCOUNT_MISMATCH" ||
      body.code === "ACCOUNT_UNKNOWN" ||
      body.code === "SOURCE_UNKNOWN" ||
      body.code === "DECLARATION_CHANGED"
        ? "needs_rebind"
        : body.code === "ACCESS_REFUSED"
          ? "access_refused"
          : "paused"
    return { paused: Number(pauseBinding(handle, { pluginId: consent.plugin_id, source, account, reason, at: nowIso, state, code: body.code ?? null })) }
  }
  const id = pluginIdOf(body)
  const changes = handle.run("update plugin_consents set state = 'paused', reason = 'paused in Memory', pause_code = null, updated = ? where plugin_id = ? and state = 'on'", nowIso, id).changes
  return { paused: Number(changes) }
}

/** plugins.resume: the person turns a paused plugin back on (session only). An account or package change needs a new confirmation instead. */
export function resumePlugin({ handle, nowIso }, body) {
  const id = pluginIdOf(body)
  // Per binding when the person named one (`source` and `account`): the row whose button they pressed, and
  // nothing else (N4b). Without them, the plugin's own paused rows.
  const named = typeof body?.source === "string" && body.source ? { source: body.source, account: String(body.account ?? "default") || "default" } : null
  const rows = named
    ? handle.all("select * from plugin_consents where plugin_id = ? and source = ? and account = ? and state in ('paused', 'access_refused')", id, named.source, named.account)
    : handle.all("select * from plugin_consents where plugin_id = ? and state in ('paused', 'access_refused')", id)
  const plugin = pluginRow(handle, id)
  let changes = 0
  for (const consent of rows) {
    const declared = plugin ? (declaresSources(plugin) ? declaredSource(plugin, consent.source) : null) : null
    const stale = plugin && declared && plugin.digest !== consent.digest
    if (stale || Number(consent.declaration_changed ?? 0) === 1) {
      // A resume never reads under an unconfirmed declaration (N2b): it becomes a confirmation instead.
      handle.run(
        "update plugin_consents set state = 'package_changed', reason = ?, declaration_changed = 1, updated = ? where source = ? and account = ?",
        "the source declaration changed; confirm it again in Memory's console".slice(0, 300),
        nowIso,
        consent.source,
        consent.account,
      )
      changes += 1
      continue
    }
    changes += handle.run(
      "update plugin_consents set state = 'on', reason = null, pause_code = null, updated = ? where source = ? and account = ? and state in ('paused', 'access_refused')",
      nowIso,
      consent.source,
      consent.account,
    ).changes
  }
  return { resumed: Number(changes) }
}

/** plugins.flag: the collector stops a binding (the account or the package changed). It only narrows. */
export function flagPlugin({ handle, nowIso }, body) {
  const { source, account } = keyOf(body, "plugins.flag")
  if (!FLAGS.includes(body.state)) throw invalid("invalid_request", `state must be one of ${FLAGS.join(", ")}.`, "A flag only stops a binding; the person turns it back on in the console.")
  const reason = errorText(String(body.reason ?? body.state), 300)
  handle.run("update plugin_consents set state = ?, reason = ?, updated = ? where source = ? and account = ? and state in ('on', 'paused')", body.state, reason, nowIso, source, account)
  return { consent: consentRow(handle, handle.get("select * from plugin_consents where source = ? and account = ?", source, account)) }
}

// ---------------------------------------------------------------------------
// plugins.report and plugins.list

/**
 * After a plugins.report: classify each consent's plugin against its consent.
 * Runs in the report's transaction. A missing, invalid or unverified row
 * changes nothing (the collector stops on its own when it can't verify the
 * declaration on disk); a pin change pauses; a removed source ends it.
 */
export function applyReport(handle, nowIso) {
  // Every binding the person still holds: `on`, and the states a resume or a re-consent could lift. A paused or
  // needs-rebind binding whose declaration changed is flipped too, so a later resume never reads under a digest
  // the person did not confirm (B4).
  for (const consent of handle.all("select * from plugin_consents where state in ('on', 'paused', 'needs_rebind', 'access_refused')")) {
    const row = pluginRow(handle, consent.plugin_id)
    if (!row || (row.state !== "available" && row.state !== "conflict") || !row.manifest) continue
    if (row.package_name !== consent.package_name || row.source_kind !== consent.source_kind || row.source_ref !== consent.source_ref) {
      const was = consent.source_kind === "local" ? `local ${consent.source_ref}` : `${consent.package_name} (${consent.source_ref})`
      handle.run("update plugin_consents set state = 'package_changed', reason = ?, updated = ? where source = ? and account = ?", `the package serving ${consent.source} changed from ${was}; confirm it again in Memory's console`.slice(0, 300), nowIso, consent.source, consent.account)
      continue
    }
    // The current contract: the descriptor hash is the pin. Any change re-asks
    // the person (the contract's rule), and a source the descriptor no longer
    // declares is removed.
    if (declaresSources(row)) {
      if (!declaredSource(row, consent.source)) {
        handle.run("update plugin_consents set state = 'removed', reason = ?, updated = ? where source = ? and account = ?", `${consent.plugin_id} no longer declares the source ${consent.source}`, nowIso, consent.source, consent.account)
        continue
      }
      if (row.digest !== consent.digest) {
        // The declaration half only (N4a): an owner or account cause stays, and the binding stays a rebind —
        // the person sees both, and a reconfirm clears only the declaration.
        const ownerCause = consent.pause_code === "OWNER_CHANGED" || consent.pause_code === "ACCOUNT_MISMATCH" || consent.pause_code === "ACCOUNT_UNKNOWN"
        handle.run(
          "update plugin_consents set state = ?, reason = ?, declaration_changed = 1, updated = ? where source = ? and account = ? and state in ('on', 'paused', 'needs_rebind', 'access_refused', 'package_changed')",
          ownerCause ? "needs_rebind" : "package_changed",
          (ownerCause ? consent.reason : "the source declaration changed; confirm it again in Memory's console")?.slice(0, 300) ?? null,
          nowIso,
          consent.source,
          consent.account,
        )
        continue
      }
      continue
    }
    if (row.digest === consent.digest && !consent.live_digest) continue
    if (row.digest === consent.live_digest) continue
    const result = classify({ snapshot: parse(consent.snapshot_json, null), limits: parse(consent.limits_json, null) }, row.manifest, { sourceId: consent.source, kind: consent.source_kind === "local" ? "local" : "package", edited: Boolean(row.edited) })
    if (result.removed) {
      handle.run("update plugin_consents set state = 'removed', reason = ?, updated = ? where source = ? and account = ?", `${consent.plugin_id} no longer declares the source ${consent.source}`, nowIso, consent.source, consent.account)
      continue
    }
    const applied = result.items.filter((item) => item.applied)
    const settled = result.pending.length === 0
    handle.run(
      "update plugin_consents set snapshot_json = ?, digest = ?, live_digest = ?, version = ?, updated = ? where source = ? and account = ?",
      JSON.stringify(result.next),
      settled ? row.digest : consent.digest,
      settled ? null : row.digest,
      row.version ?? consent.version,
      nowIso,
      consent.source,
      consent.account,
    )
    handle.run("delete from plugin_pending where source = ? and account = ?", consent.source, consent.account)
    result.pending.forEach((item, seq) => {
      handle.run("insert into plugin_pending (source, account, seq, plugin_id, digest, class, what, created) values (?, ?, ?, ?, ?, ?, ?, ?)", consent.source, consent.account, seq, consent.plugin_id, row.digest, item.class, item.what.slice(0, 300), nowIso)
    })
    for (const item of applied) {
      handle.run("insert into plugin_changes (source, account, plugin_id, class, what, from_digest, to_digest, at) values (?, ?, ?, ?, ?, ?, ?, ?)", consent.source, consent.account, consent.plugin_id, item.class, item.what.slice(0, 300), consent.digest, row.digest, nowIso)
    }
  }
}

/** For plugins.list: the consents whose binding still exists, and the requests waiting. */
export function listConsents(handle, nowIso = new Date().toISOString()) {
  const consents = handle
    .all("select c.* from plugin_consents c join sources s on s.source = c.source and s.account = c.account order by c.source, c.account")
    .map((row) => consentRow(handle, row))
  // Every request a collector must act on is listed, whatever its age: a
  // `requested` one, an `attention` one past its retry time, and a `failed` one
  // that is due for its next attempt (re-check L). A `failed` row still waiting
  // on its own back-off is not actionable yet, and waits in the rest. The
  // actionable rows come oldest first and are capped at MAX_LISTED_REQUESTS, so
  // the longest-waiting are seen and the list still cannot grow without bound;
  // the same bound applies to the rest, so a hundred reported-but-unconfirmed
  // rows can never hide one the collector has to answer.
  const actionable = handle.all(
    "select * from plugin_requests where state = 'requested' or ((state = 'attention' or state = 'failed') and (retry_at is null or retry_at <= ?)) order by requested_at asc, source, account limit ?",
    nowIso,
    MAX_LISTED_REQUESTS,
  )
  const seen = new Set(actionable.map((row) => `${row.source}\u0000${row.account}`))
  const rest = handle
    .all("select * from plugin_requests order by requested_at desc, source, account limit ?", MAX_LISTED_REQUESTS + actionable.length)
    .filter((row) => !seen.has(`${row.source}\u0000${row.account}`))
    .slice(0, MAX_LISTED_REQUESTS)
  const requests = [...actionable, ...rest].map(requestRow)
  return { consents, requests }
}

// ---------------------------------------------------------------------------
// events.ingest

/**
 * The plugin check of one events.ingest page, after the store's binding check
 * (the confirmed owner): the consent of (source, account) decides. Throws for
 * a refused page; returns the events to store and the refusals of events whose
 * kind was not confirmed. A payload's `plugin_id` is never read.
 *
 * A refusal names the event's id and kind, and never its words: the store
 * audits it as ids only (`event_refusals`).
 *
 * @returns {{ events: unknown[], refusals: { external_id: string | null, kind: string | null, reason: string }[] }}
 */
export function checkIngest(handle, { source, account, owner, scope }, events) {
  const consent = handle.get("select * from plugin_consents where source = ? and account = ?", source, account)
  // A declared source is read only under a current consent: its descriptor hash,
  // its scope and its cost are what the person confirmed. A binding made through
  // the old Bind flow (or before plugins) has none, and stores nothing.
  const declaring = declaringPlugins(handle, source)
  if (!consent) {
    if (declaring.length) {
      const who = declaring.map((row) => `${row.package_name ?? row.plugin_id} (${row.plugin_id})`).join(", ")
      throw conflict("plugin_consent_required", `${source} is declared by the installed plugin ${who}, and this binding has no plugin consent: no descriptor hash, scope or cost was confirmed. Nothing was stored.`, CONSOLE_NEXT)
    }
    return { events, refusals: [] }
  }
  refuseDenied(consent.plugin_id, consent.package_name)
  if (consent.state !== "on") {
    throw conflict("plugin_paused", `Collection from ${source} (${account}) is stopped: ${consent.reason ? errorText(consent.reason, 200) : consent.state}. Nothing was stored.`, CONSOLE_NEXT)
  }
  // A consent is bound to the package that declared the source when the person
  // confirmed it. Another package serving the same id is a hijack, not a rebind.
  if (declaring.length && !declaring.some((row) => row.plugin_id === consent.plugin_id && row.package_name === consent.package_name)) {
    const who = declaring.map((row) => row.package_name ?? row.plugin_id).join(", ")
    throw conflict("plugin_consent_required", `${source} is declared by ${who} now, and this binding was confirmed for ${consent.package_name}. Nothing was stored.`, CONSOLE_NEXT)
  }
  if (owner?.id !== consent.owner_id) throw conflict("plugin_owner", `${source} (${account}) was confirmed for ${consent.owner_label ?? consent.owner_id}. Nothing was stored.`, CONSOLE_NEXT)
  const confirmed = parse(consent.scope_json, {})
  const keys = Object.keys(confirmed)
  const echo = scope === undefined || scope === null ? null : scope
  // A confirmation with no scope key is the whole source (contract 2's `{}`), so
  // an echo naming what the source read is inside it; the source's own option is
  // what bounds the read. A confirmed key is still held to, id by id.
  const scopeOk =
    (keys.length === 0) ||
    (keys.length > 0 &&
      isObject(echo) &&
      Object.entries(echo).every(([key, ids]) => Array.isArray(confirmed[key]) && Array.isArray(ids) && ids.every((item) => confirmed[key].includes(item))))
  if (!scopeOk) throw conflict("plugin_scope", `The events from ${source} (${account}) name a scope outside the one the person confirmed. Nothing was stored.`, "The collector sends only the confirmed scope; a plugin that widens it is refused.")
  const snapshot = parse(consent.snapshot_json, null)
  // A v2 source declares kinds; a descriptor item declares one `reads` kind.
  const kinds = snapshot?.source?.kinds ?? (snapshot?.source?.reads ? [snapshot.source.reads] : [])
  const allowed = []
  const refusals = []
  for (const event of Array.isArray(events) ? events : []) {
    if (isObject(event) && !kinds.includes(event.kind)) refusals.push({ external_id: event.external_id === undefined ? null : String(event.external_id).slice(0, 100), kind: typeof event.kind === "string" ? event.kind.slice(0, 40) : null, reason: `kind ${String(event.kind).slice(0, 20)} was not confirmed for ${source}` })
    else allowed.push(event)
  }
  return { events: allowed, refusals }
}
