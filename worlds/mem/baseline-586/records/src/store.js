import { isSourceName } from "./source-ids.js"
import { installedSilver } from "./engine/silver-readers.js"
/**
 * The records store (contract §2.5): one SQLite file per control space under
 * `<dataDir>/spaces/<space_id>.db`, WAL, `busy_timeout 5000`, created on the
 * first write and migrated at open. The file is keyed by the space id, never
 * by the container: legacy personal spaces share containers, so a file per
 * container would put two people's private records in one file.
 *
 *   const store = openStore({ dataDir })
 *   const space = store.forSpace("spc_123")
 *   await space.put({ record: { kind: "memory", type: "decision", body: "…" } }, actor)
 *
 * Every SpaceStore method takes `(input, actor)` with
 * `actor = {user, agent, session, role, grants, space, spaceKind, team, tz}`.
 * Writes record the actor's container (`meta.team`), the core's service id
 * (`meta.service`), the space kind (`meta.space_kind`) and, for a personal
 * space, its owner (`meta.owner_user`, never the routines' own user);
 * `meta()` and `listSpaces()` read them back for the routines. Each method
 * enforces the
 * actor's access itself (§2.2), so the HTTP server and the plugin's test stub
 * behave the same. Errors are `RecordsError`s carrying the HTTP status, code,
 * message and next step.
 *
 * node:sqlite is synchronous, so each method runs to completion without
 * interleaving with another in this process; writes still take `BEGIN
 * IMMEDIATE` so a second process (a backup) waits on `busy_timeout`.
 */
import fs from "node:fs"
import path from "node:path"
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { DatabaseSync } from "node:sqlite"
import {
  JOBS_USER,
  ROUTINE_USER,
  SYSTEM_ACTOR,
  canRead,
  canWrite,
  hasRole,
  normalizeActor,
  requireRole,
  visibilityClause,
} from "./access.js"
import { isInstructionShaped, refusal, unstorable } from "./curation.js"
import { storable } from "./storable.js"
import { GRANT_AUDIENCE, actionInputDigest, verifyActionGrant } from "./action-grant.js"
import { issueReservation } from "./p2-reservation.js"
import { assertAct } from "./acts.js"
import { HELD_EDITS_MAX, heldEditsProblem } from "./held-text.js"
import { RecordsError, actRefused, conflict, forbidden, grantRefused, invalid, notFound, ownerChangeConsoleOnly, pageLinesKept, refused, teamDeleteConsoleOnly, tooLarge } from "./errors.js"
import { exportFileName, tarGz, toMarkdown } from "./export.js"
import { RECORD_ID, eventId, recordId, sha256, ulid } from "./ids.js"
import { FEATURE_VERSION, FORGOTTEN_ID, FORGOTTEN_KINDS, MAX_PER_AUTHOR, MAX_TEXT_CHARS, PURGE_VERSION, PURGE_WINDOW_DAYS, TEXT_MAX_WORDS, FORGET_SECRET_MIN_BYTES, authorMatcher, fingerprintOf, hashTerm, newForgottenKey, normalWords, purgeHashes, purgeSalt, spaceMatcher, substantiveSentences, textHash, textTombstoneKey } from "./forgotten.js"
import { PATH, deriveLinks, normalizeTarget, rewriteBody, rewriteBodyMap, rewriteFieldLinks, rewriteFieldLinksMap } from "./links.js"
import {
  DEFAULT_STATUSES,
  KINDS,
  PERSON_CLAIM_REASON,
  STATUSES,
  checkPath,
  isDateOrDateTime,
  mayStatePerson,
  newRecord,
  pageTypeForPath,
  updatedRecord,
} from "./model.js"
import { contentHash, FUTURE_EVENT_REASON, isFarFuture, normalizeEvent, sameHash, sessionIdOf } from "./events-normalize.js"
import { enroll, reentryOf, requeueCapped, seqCounter, storedContentHash } from "./engine/cursors.js"
import { engineMode, engineOn } from "./engine/flag.js"
import { laneContext, laneOf } from "./engine/lanes.js"
import { clearReady, readyIndex, touchReady } from "./engine/ready.js"
import { personFrom } from "./routines/passes.js"
import { addDays, dayBounds, localDay, safeTz } from "./routines/dates.js"
import { removalProblems } from "./vendor/source-contract/events.js"
import { SCHEMA_VERSION, migrate } from "./schema.js"
import { JOBS_SCHEMA } from "./jobs/schema.js"
import { markMeetingPending } from "./jobs/rows.js"
import { drainForget, pendingForgets } from "./claims/forget.js"
import { checkClaimsBuild } from "./claims/build.js"
import { expireSilver, fenceSilver, invalidateSilver, removeDerivativeEdges } from "./silver/store.js"
import { descriptorHash, manifestDigest, validateManifest } from "./plugins/manifest.js"
import * as pluginConsent from "./plugins/consent.js"
import { anchorBinding, historyOf, importHistory } from "./plugins/history-import.js"
import { chosenHistoryDays, requestHistory } from "./plugins/history-window.js"
import { PLUGIN_MISSING, listedState } from "./plugins/seen.js"
import { declaredKind } from "./plugins/consent.js"
import { bindingProblem, legacyNamed, retiredSources } from "./plugins/legacy-sources.js"
import { appendToSection, cut, errorText, failureText, ftsQuery, insertedOnly, restylesTeamPage, snippet, titleFromBody } from "./text.js"

/** A journal page's path: the person's own by definition (FIX-0911). */
const JOURNAL_PATH = /^journal(?:\/|$)/

/**
 * The author a page keeps once its author's account is erased: the team keeps
 * its content and its history, and nothing names the person
 * (docs/operations/account-erasure.md).
 */
const ANONYMOUS_AUTHOR = "former-member"
/** A control user id, as an erasure names one. */
const USER_ID_LIKE = /^[A-Za-z0-9._:@-]{1,200}$/

// ---------------------------------------------------------------------------
// A source's removal of an event (DESIGN-jelly-sources §5.1-§5.3, 0.11)

/** How long one worker tick may run its slices for, before it waits for the next (0.11 review R7). */
const REMOVAL_TICK_MS = 1_000

/** The time one backfill slice and one drain slice may take in a tick (0.11 review R6-B1, R6-S2). */
const BACKFILL_SLICE_MS = 150
const DRAIN_SLICE_MS = 150

/** How many removals one batch retracts, and how many records one may rewrite (0.11 review R5-B1). */
const MAX_REMOVALS_PER_INGEST = 20
const MAX_RETRACT_RECORDS = 200

/** Any letter or digit: what a tombstone, which is empty of words, does not hold. */
const HAS_WORDS = /[\p{L}\p{N}]/u

/**
 * jelly's removal convention, and the only one Memory has until the contract
 * carries `removals[]` (§5.4, not in 0.11): the **same `external_id`**
 * re-emitted with a later `occurred_at`, no words, no link, and the label
 * `gone` or `withheld` (`jelly-sources.ts:258-277`). A label is not a
 * contract — that is why the removal leaves an audit line naming the rule —
 * and it is why a `file` event with words, or a wordless one with another
 * label, is a file rather than a removal.
 *
 * @returns {{reason: "gone"|"withheld"} | null}
 */
function removalOf(event) {
  if (!event || event.kind !== "file") return null
  const labels = Array.isArray(event.labels) ? event.labels : []
  const reason = labels.includes("withheld") ? "withheld" : labels.includes("gone") ? "gone" : null
  if (!reason) return null
  // A tombstone has no words **and no link** (§5.1): one that still carries a
  // url is a file whose text a provider dropped, not a removal (0.11 review, S1).
  if (HAS_WORDS.test(String(event.text ?? ""))) return null
  return event.url ? null : { reason }
}

/**
 * The contract's own removals (`removals[]`, source-contract v0.2.0 #36): a page
 * that names, by `external_id`, the events its source removed, with the reason
 * it gave (`deleted`, `withheld` or `expired`) and when. It is the fact itself,
 * so the store no longer infers a removal from a re-emitted label — but the
 * label rule above still holds for the plugins that send nothing else, and both
 * reach the one retraction path below, one queue drained in ticks.
 *
 * The page has already been held to the contract by the consumer's
 * `acceptAnswer`; this is the store's own check on what it is about to store, and
 * a page that breaks it is refused whole rather than half retracted. The rules
 * are the package's own `removalProblems`, imported rather than copied: an id of
 * up to 512 characters (the length an event's own may be), `at` as a UTC ISO
 * date-time ending in Z, one of its three reasons, and at most 500 in one page.
 * A second copy of those limits is how a store comes to hold 512 and refuse 100.
 *
 * @returns {{externalId: string, reason: string, at: string}[]}
 */
function contractRemovals(value) {
  if (value === undefined || value === null) return []
  const problems = removalProblems({ removals: value })
  if (problems.length > 0) throw invalid("invalid_removals", problems[0], "Send the removals the source's events_list returned, unchanged.")
  return value.map((entry) => ({ externalId: entry.external_id, reason: entry.reason, at: entry.at }))
}

/** An event row's labels with one more on the end: the reason a removal gave, where the drain reads it. */
function labelsWith(labels, reason) {
  let kept = []
  try {
    const parsed = JSON.parse(String(labels ?? "[]"))
    if (Array.isArray(parsed)) kept = parsed
  } catch {
    kept = []
  }
  return JSON.stringify(kept.includes(reason) ? kept : [...kept, reason])
}

/**
 * A body with one event's citation and link taken out. A rendered line — the
 * one a job's block holds, between its `<!-- lens:… -->` markers — was Memory's
 * own, so that line goes whole. **Every other line is the person's**: only the
 * citation and the link come off it, and their words stay (0.11 review, B1).
 */
/**
 * A body after a removal, by the rule the review set (0.11 review R3-B1/R3-B2):
 *
 * 1. a line is affected **only** if it carries a citation of the removed event —
 *    Memory's `[event evt_…]` marker, the link the event carried, or the quote
 *    Memory recorded for it. Every other line is byte-for-byte unchanged, so a
 *    short title, a shared turn of phrase or a name is never taken from the
 *    person's own words;
 * 2. in an affected line only the marker, the link and **that exact quote** come
 *    off — never a run of it, never a title, never another word;
 * 3. a line inside a block Memory rendered (`<!-- lens:… -->`) goes whole;
 * 4. on a page Memory wrote (the routines' journal), only the lines Memory
 *    wrote go whole; the person's own lines on it follow rule 2.
 */
function scrubEventBody(body, { eventId, url, quotes = [], memoryLines = null, recordHasMarker = true }) {
  const cite = `[event ${eventId}]`
  const out = []
  let inBlock = false
  for (const line of String(body ?? "").split("\n")) {
    if (/^\s*<!--\s*lens:[^>]*-->\s*$/.test(line)) {
      inBlock = true
      out.push(line)
      continue
    }
    if (/^\s*<!--\s*\/lens\s*-->\s*$/.test(line)) {
      inBlock = false
      out.push(line)
      continue
    }
    const cites = line.includes(cite)
    if (cites && (inBlock || Boolean(memoryLines?.has(line)))) continue
    const links = Boolean(url) && line.includes(url)
    const quoted = quotes.filter((quote) => typeof quote === "string" && quote.length > 0 && line.includes(quote))
    // A quote is a citation only when it is the record's only one: a record
    // that carries the marker elsewhere cites by the marker, so a line without
    // one is the person's own (0.11 review R4-B1).
    const byQuote = quoted.length > 0 && !recordHasMarker
    if (!cites && !links && !byQuote) {
      out.push(line)
      continue
    }
    let next = cites ? line.split(cite).join("") : line
    if (links) next = next.split(url).join("")
    for (const quote of quoted) next = next.split(quote).join("")
    out.push(tidyLine(next))
  }
  return out.join("\n")
}

/** A line with the debris a removal leaves behind taken out: empty quotes and brackets, doubled spaces, a space before punctuation. */
function tidyLine(line) {
  const indent = /^[ \t]*/.exec(line)[0]
  // The debris goes first, then the spaces it leaves behind: an empty pair of
  // quotes removed after collapsing would leave two (0.11 review R5, nit).
  const rest = line
    .slice(indent.length)
    .replace(/\(\s*\)/g, "")
    .replace(/\[\s*\]/g, "")
    .replace(/"\s*"/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/[ \t]+$/, "")
  return indent + rest
}

/**
 * The fields of a record that cited a removed event, with the removed file's
 * quote, its citation and its link taken out, and the removal itself recorded
 * on the record (`fields.removed_sources`) so the person can see which of their
 * memories came from a file that was removed.
 */
function scrubFieldsForEvent(fields, { eventId, reason, at, withdraw }) {
  const next = { ...(fields && typeof fields === "object" ? fields : {}) }
  if (next.event_id === eventId) delete next.event_id
  if (Array.isArray(next.events)) {
    const left = next.events.filter((id) => id !== eventId)
    if (left.length > 0) next.events = left
    else delete next.events
  }
  if (Array.isArray(next.evidence)) {
    next.evidence = next.evidence.map((entry) => {
      if (!entry || typeof entry !== "object" || entry.event !== eventId) return entry
      const { quote: _quote, ...rest } = entry
      return rest
    })
  }
  if (withdraw && next.payload && typeof next.payload === "object") {
    // The proposal's payload is the words it would have written: only what it
    // was for is kept, as a meeting proposal's retirement keeps it.
    next.payload = { kind: next.payload.kind ?? null, type: next.payload.type ?? null }
  } else if (next.payload && typeof next.payload === "object") {
    const payload = { ...next.payload }
    for (const key of ["body", "text"]) {
      if (typeof payload[key] === "string") payload[key] = withoutEventCite(payload[key], eventId, null)
    }
    next.payload = payload
  }
  const list = Array.isArray(next.removed_sources) ? next.removed_sources.filter((entry) => entry?.event !== eventId) : []
  next.removed_sources = [...list, { event: eventId, reason, at }]
  return next
}

/**
 * One record after a removal: a waiting proposal is **withdrawn** (its words
 * are not kept anywhere, and its versions are scrubbed the same way), and a
 * record the person already has keeps its own words and loses the removed
 * file's.
 */
function removalScrub(record, { eventId, url, reason, at, withdraw, memoryLines = null }) {
  const fields = scrubFieldsForEvent(record.fields, { eventId, reason, at, withdraw })
  // The one quote Memory recorded for this citation: the evidence this record
  // cited. The file's own text is **not** a recorded quote and never affected a
  // line on its own (0.11 review R4-B1).
  const quotes = (Array.isArray(record.fields?.evidence) ? record.fields.evidence.filter((entry) => entry?.event === eventId).map((entry) => entry.quote) : []).filter(
    (quote, index, all) => typeof quote === "string" && quote.length > 0 && all.indexOf(quote) === index,
  )
  const recordHasMarker = String(record.body ?? "").includes(`[event ${eventId}]`)
  const body = scrubEventBody(record.body, { eventId, url, quotes, memoryLines, recordHasMarker })
  // A title derived from the body holds the quote too: re-derive it from the
  // scrubbed body; one that is the person's own loses only the marker, the link
  // and the recorded quote (0.11 review R8-B4).
  let title = record.title
  if (record.title === titleFromBody(record.body)) title = titleFromBody(body)
  else {
    let own = String(record.title ?? "").split(`[event ${eventId}]`).join("")
    if (url) own = own.split(url).join("")
    for (const quote of quotes) own = own.split(quote).join("")
    title = tidyLine(own).trim()
  }
  if (!withdraw) return { title, body, fields }
  // Where the proposal pointed stays, as a meeting proposal's retirement keeps it.
  const where = /\[meeting [^\]\n]{0,300}\]/.exec(String(record.body ?? ""))?.[0] ?? ""
  return {
    title: "withdrawn proposal",
    body: `Withdrawn; the words it quoted are not kept.${where ? ` ${where}` : ""}`,
    fields: { ...fields, retired_reason: "the source removed this item", retired_at: at },
  }
}

/**
 * Every event one record cites (0.11 review R5-B1): its `fields.event_id`, the
 * events in `fields.events` and `fields.evidence`, and each `[event evt_…]` in
 * its body. A pure function of the record, so the write path indexes exactly
 * what the removal looks up.
 */
function citeEventsOf(record) {
  const events = new Set()
  const fields = record?.fields && typeof record.fields === "object" ? record.fields : {}
  if (typeof fields.event_id === "string") events.add(fields.event_id)
  for (const id of Array.isArray(fields.events) ? fields.events : []) if (typeof id === "string") events.add(id)
  for (const entry of Array.isArray(fields.evidence) ? fields.evidence : []) if (typeof entry?.event === "string") events.add(entry.event)
  for (const match of String(record?.body ?? "").matchAll(/\[event (evt_[A-Za-z0-9]{1,64})\]/g)) events.add(match[1])
  return [...events].filter((event) => /^evt_[A-Za-z0-9]{1,64}$/.test(event))
}

/** True when this space's file has the table (a later schema's, or an older one's). */
function hasTable(handle, name) {
  return Boolean(handle.get("select 1 as present from sqlite_master where type = 'table' and name = ?", name))
}

/**
 * Whether a page's body still has the `## section` an append proposal names.
 * A heading inside a fenced code block is an example, not a section: the fence
 * is tracked so a quoted heading never counts.
 */
function hasSection(body, section) {
  const wanted = String(section ?? "").trim().toLowerCase()
  if (!wanted) return false
  let fence = false
  for (const line of String(body ?? "").split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) {
      fence = !fence
      continue
    }
    if (fence) continue
    if (/^##\s+/.test(line) && line.replace(/^##\s+/, "").trim().toLowerCase() === wanted) return true
  }
  return false
}

/**
 * Whether a caller is an agent's bearer on a team-visible space (FIX-0911): a
 * shared space, or another person's space reached through a grant. The
 * person in a browser session of the console, and the routines, are not.
 */
function bearerOnTeamPage(actor, meta) {
  if (actor?.credential === "session" || actor?.user === ROUTINE_USER) return false
  // Memory's job runner writes the block a job owns into the person's own
  // space (DESIGN-MEMORY-JOBS §6.2), with its own ledger. In a shared space it
  // is still a bearer on a team page like any other.
  if (actor?.user === JOBS_USER) return actor?.spaceKind === "shared" || meta?.space_kind === "shared"
  return actor?.spaceKind === "shared" || meta?.space_kind === "shared" || Boolean(meta?.owner_user && meta.owner_user !== actor?.user)
}

/**
 * FIX-0914: on a team page a bearer only adds lines. Shared by a direct put
 * (#update) and an accepted proposal (#apply), so the two routes agree: a
 * title or type change, or a body that changes or removes a line, is refused.
 * Returns the refusal, or null when the change is only inserted lines.
 */
function teamPageLinesRefusal(current, next) {
  if (next.title !== current.title || next.type !== current.type) {
    return pageLinesKept(`${current.path} is a team page: an agent does not retitle or retype it.`)
  }
  if (next.body === current.body) return null
  const kept = insertedOnly(current.body, next.body)
  if (kept.ok) return null
  const shown = [...kept.missing, ...kept.hiding].slice(0, 5).map((line) => `"${cut(line, 160)}"`).join("; ")
  return pageLinesKept(`${current.path} is a team page: an agent only adds lines, and this ${kept.missing.length ? `changes or removes ${kept.missing.length} line(s)` : "inserts a comment or fence"}: ${shown}.`)
}

export { SYSTEM_ACTOR } from "./access.js"
export { RecordsError } from "./errors.js"

/** A control space id, the file's key (contract §2.2). */
export const SPACE_ID = /^[A-Za-z0-9_.-]{1,128}$/
/** A container id (`team_id`), recorded in meta for the routines' core reads. */
export const TEAM_ID = /^[A-Za-z0-9_.-]{1,128}$/
/**
 * The `gap` of a page (§8.3.4): `{ reason, since }`, with `expired` or
 * `window-truncated` and an ISO time no more than 31 days back. `undefined`
 * when the page names none; a 400 when it is malformed.
 */
export function gapOf(value, now = Date.now()) {
  if (value === undefined || value === null) return undefined
  if (!isPlainObject(value)) throw invalid("invalid_gap", "gap must be { reason, since }.", "Send the gap events_list answered with, or leave it out.")
  if (value.reason !== "expired" && value.reason !== "window-truncated") throw invalid("invalid_gap", "gap.reason must be expired or window-truncated.", "Send the reason the source gave.")
  const at = typeof value.since === "string" ? Date.parse(value.since) : Number.NaN
  if (!Number.isFinite(at)) throw invalid("invalid_gap", "gap.since must be an ISO date-time.", "Send the ISO time the source gave.")
  if (at > now + 60_000) throw invalid("invalid_gap", "gap.since is in the future.", "Send the time the source restarted its window.")
  if (at < now - 31 * 86_400_000) throw invalid("invalid_gap", "gap.since is more than 31 days back.", "A resync reads at most 31 days.")
  return { reason: value.reason, since: new Date(at).toISOString() }
}

/** plugins.report (DESIGN-PLUGIN-MEMORY §3.2): a plugin id as OpenCode lists it, the states discovery reports, and a cap. */
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const PLUGIN_STATES = Object.freeze(["available", "invalid", "unverified", "conflict"])
const MAX_REPORTED_PLUGINS = 100
/**
 * What Sources calls a collector that reports a failure without naming its
 * machine: one too old to send `host`. A fixed label, never a machine's own
 * name — it holds a space and a capital, and `#host()` lower-cases a name.
 */
const UNNAMED_COLLECTOR = "unnamed: an older Memory"
const EDGE_TYPES = new Set(["link", "supersedes", "source"])
/** A failed bind request is asked again after 1 hour, then 6 hours; the third failure needs the person's attention. */
const REQUEST_BACKOFF_MS = Object.freeze([3_600_000, 6 * 3_600_000])
const REQUEST_MAX_FAILURES = 3
/** The service's own principals. Their writes are checked against what a person forgot (J4). */
const SYSTEM_USERS = new Set([ROUTINE_USER, JOBS_USER])
/**
 * The trait gate's verdicts one local day may keep (lane 0198). A day of 300
 * units is far below it; the cap only stops one pathological day from growing a
 * space file without limit, and the oldest verdicts go first.
 */
const TRAIT_READS_PER_DAY = 4_000
const REVISE_ACTIONS = ["correct", "confirm", "retire", "restore", "contest", "forget_versions"]
/** Texts one forgotten.check takes, and the characters of each it reads. */
const MAX_CHECK_TEXTS = 100
const MAX_CHECK_CHARS = 20_000
/** Predecessors one forget erases along a supersession lineage. */
const MAX_LINEAGE = 200
/** An ISO 8601 time, as `since` takes it. */
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/
/** What a batch revise (`{ids, action}`) does to each id: forget deletes as records.delete does. */
export const BATCH_ACTIONS = Object.freeze(["confirm", "retire", "restore", "contest", "forget"])
/** Ids one batch revise takes. */
export const MAX_BATCH = 100
/** How deep a search pages (offset + limit). */
const SEARCH_DEPTH = 500
const DECISIONS = ["accept", "reject", "edit"]
const LIST_BODY = 500
const MAINTAIN_EVERY_MS = 60 * 60 * 1000
const STATEMENT_CACHE = 256

/**
 * Keyed writes (docs/design/records-idempotency.md): the methods that apply an
 * `idempotency_key` at most once and replay the original result, as
 * `space.stats` advertises them.
 */
export const REPLAY_METHODS = Object.freeze(["records.put", "records.revise", "records.append", "records.move", "records.delete"])
export const REPLAY_VERSION = 1
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{16,128}$/
const MAX_ATTEMPT_AGE_MS = 366 * 86_400_000
/** The most pages one folder move (records.move with path_prefix) takes. */
export const MAX_PREFIX_MOVE = 200
export const RECEIPT_TTL_MS = 24 * 60 * 60 * 1000
/** The agent names `agents.mine` answers at most: one page, newest first. */
export const AGENTS_MINE_LIMIT = 100
/**
 * Receipts are kept this long past the window before they are pruned, so a
 * retry the service accepts (first attempt younger than the window, by the
 * client's own clock) always finds its receipt: the client's measure of the
 * attempt's age can only lag the receipt's age by the requests' transit times.
 */
export const RECEIPT_GRACE_MS = 60 * 60 * 1000
export const RECEIPT_MAX = 50_000

/**
 * How long a preview's snapshot is worth spending. A person opens the host's
 * confirmation, reads it, and presses: Jelly holds that question open for at
 * most a few minutes, and the grant it signs at the press is a minute long, so
 * the snapshot only has to outlast the reading. Past this the press asks for a
 * fresh preview rather than spend a snapshot nobody can still be looking at.
 */
export const PREVIEW_TTL_SECONDS = 600

/** The most a preview's snapshot may carry: a few facts the press cannot know. */
const MAX_PREVIEW_BINDING_BYTES = 2048

/** How many replaced bindings one preview row keeps, so a replacement is visible. */
const MAX_PREVIEW_REVISIONS = 5

/**
 * The digest a preview's snapshot is keyed by: the person's own input.
 *
 * The host adds one key of its own, `jellySpeaker`, and mints a fresh id for
 * every call (`backend/host/src/view-speakers.ts`), so the preview's id and the
 * press's always differ: normalising that one key away is what makes the
 * preview's digest and the press's the same. The speaker never names a page's
 * choice, and it names the same person either way.
 *
 * @param {unknown} input
 * @returns {string} base64url(sha256(canonical JSON of the person's input))
 */
export function previewDigest(input) {
  const body = input && typeof input === "object" && !Array.isArray(input) ? input : {}
  const { jellySpeaker: _speaker, ...person } = body
  return actionInputDigest(person)
}

/** One open space file, with its prepared statements. */
class Handle {
  constructor(db, file, empty = false) {
    this.db = db
    this.file = file
    this.empty = empty
    this.stmts = new Map()
    this.depth = 0
    this.maintainedAt = 0
    /** Cached meta rows (team, service, space_kind, owner_user) once read. */
    this.meta = null
    /**
     * The receipts this file holds, counted once per open handle and kept
     * up to date on insert and prune, so an insert never counts the table.
     * Another process's inserts are not seen: the cap is a soft limit, and an
     * undercount can only delay a capacity refusal, never evict a receipt.
     */
    this.receiptCount = null
    /** A forget's WAL truncation found a reader in the way; maintenance tries again. */
    this.erasePending = false
    /** When this handle last pruned spent grants, so the act path prunes at most once a minute. */
    this.grantsPrunedAt = 0
    /** Callers holding this handle across their own work (`holdSpace`). */
    this.users = 0
  }

  stmt(sql) {
    let stmt = this.stmts.get(sql)
    if (!stmt) {
      if (this.stmts.size >= STATEMENT_CACHE) this.stmts.clear()
      stmt = this.db.prepare(sql)
      this.stmts.set(sql, stmt)
    }
    return stmt
  }

  all(sql, ...params) {
    return this.stmt(sql).all(...params)
  }

  get(sql, ...params) {
    return this.stmt(sql).get(...params)
  }

  run(sql, ...params) {
    return this.stmt(sql).run(...params)
  }

  /**
   * Run `fn` inside a savepoint: it commits or rolls back on its own, whether or
   * not an outer transaction is open. A nested `tx` joins the outer transaction
   * and cannot roll back alone, which is what a batch inside a lease needs (the
   * engine's `commitBatch`), so that path uses this.
   */
  savepoint(fn) {
    if (this.empty) throw new Error("records: write attempted on the empty read handle")
    const erasePending = this.erasePending
    const name = `sp_${(this.savepoints = (this.savepoints ?? 0) + 1)}`
    this.db.exec(`savepoint ${name}`)
    try {
      const result = fn()
      this.db.exec(`release ${name}`)
      return result
    } catch (error) {
      try {
        this.db.exec(`rollback to ${name}`)
        this.erasePending = erasePending
        this.db.exec(`release ${name}`)
      } catch {
        // Preserve the original error if rollback/release fails. Restore the
        // transaction-owned flag only after SQLite actually rolls back.
      }
      throw error
    }
  }

  /** Run `fn` in one immediate transaction; a nested call joins the outer one. */
  tx(fn) {
    if (this.empty) throw new Error("records: write attempted on the empty read handle")
    if (this.depth > 0) {
      this.depth += 1
      try {
        return fn()
      } finally {
        this.depth -= 1
      }
    }
    const erasePending = this.erasePending
    this.db.exec("begin immediate")
    this.depth = 1
    try {
      const result = fn()
      this.db.exec("commit")
      return result
    } catch (error) {
      try {
        this.db.exec("rollback")
        this.erasePending = erasePending
      } catch {
        // Preserve the original error; a failed rollback leaves the flag dirty.
      }
      throw error
    } finally {
      this.depth = 0
    }
  }

  close() {
    this.stmts.clear()
    this.db.close()
  }
}

/**
 * The store's search needs SQLite's FTS5. Some Node builds ship `node:sqlite`
 * without it (Node 22.13 does), and every write would then fail with "no such
 * module: fts5". Refuse at open with the fix instead.
 */
export function assertFts5(db) {
  let enabled = 0
  try {
    enabled = Number(db.prepare("select sqlite_compileoption_used('ENABLE_FTS5') as v").get()?.v ?? 0)
  } catch {
    enabled = 0
  }
  if (enabled !== 1) {
    throw new Error(`the records store needs SQLite with FTS5, and this Node (${process.version}) ships node:sqlite without it; use Node 22.23 or later`)
  }
}

/** Open a space file with the pragmas every connection needs (exported for the tests). */
export function openDatabase(file) {
  const db = new DatabaseSync(file)
  try {
    assertFts5(db)
  } catch (error) {
    db.close()
    throw error
  }
  try {
    db.exec("pragma busy_timeout = 5000")
    if (file !== ":memory:") db.exec("pragma journal_mode = wal")
    db.exec("pragma synchronous = normal")
    // Forget erases (docs/design/forget-erase.md): a deleted row's bytes are
    // overwritten with zeros in the page and in the freelist, not left in free
    // space, and FTS5 removes a deleted row's terms from its index segments
    // instead of adding a delete marker beside them.
    db.exec("pragma secure_delete = on")
    // Temporary tables, sort spills and statement journals stay in memory: a
    // temp file is unlinked as SQLite makes it, so nothing could erase or even
    // scan what it held after a forget.
    db.exec("pragma temp_store = memory")
    migrate(db)
    ensureFtsSecureDelete(db)
    return db
  } catch (error) {
    // An unsupported protected layout is an expected startup refusal, not a
    // connection the cache owns. Close it on every failed migration/open.
    db.close()
    throw error
  }
}

/**
 * FTS5's secure-delete option, persisted in the index's config table, set
 * once per file (SQLite 3.42 or later reads such an index; Node 22.23 ships
 * 3.50). Without it a forgotten term stays in the index segments.
 */
export function ensureFtsSecureDelete(db) {
  const row = db.prepare("select v from records_fts_config where k = 'secure-delete'").get()
  if (Number(row?.v) === 1) return
  db.exec("insert into records_fts(records_fts, rank) values ('secure-delete', 1)")
}

/**
 * @param {{dataDir: string, now?: () => Date, eventRetentionDays?: number, proposalTtlDays?: number, maxOpen?: number, heldReceiptKey?: string, receiptTtlMs?: number, receiptMax?: number}} options
 */
/** The forget secret, checked: unset is "" (random salts and a stored tombstone key); too short is an error, never ignored. */
function forgetSecretOf(value) {
  if (value === undefined || value === null || value === "") return ""
  if (typeof value !== "string" || Buffer.byteLength(value) < FORGET_SECRET_MIN_BYTES) {
    throw new Error(`openStore: the forget secret must be at least ${FORGET_SECRET_MIN_BYTES} bytes (got ${typeof value === "string" ? Buffer.byteLength(value) : typeof value})`)
  }
  return value
}

export function openStore(options = {}) {
  const { dataDir } = options
  if (!dataDir || typeof dataDir !== "string") throw new Error("openStore: dataDir is required")
  const maxOpen = Math.max(1, options.maxOpen ?? 128)
  const spacesDir = path.join(dataDir, "spaces")

  /**
   * A space with work a removal must finish says so in its own small file
   * (0.11 review R7): the service's own worker finds those spaces by listing
   * `spaces/*.work`, never by opening every space file. Written only when the
   * state changes, so a quiet tick costs a stat.
   */
  const workFile = (spaceId) => path.join(spacesDir, `${spaceId}.work`)
  const markWork = (spaceId, needed) => {
    if (!SPACE_ID.test(spaceId)) return
    try {
      if (needed) {
        if (!fs.existsSync(workFile(spaceId))) fs.writeFileSync(workFile(spaceId), "")
      } else fs.rmSync(workFile(spaceId), { force: true })
    } catch {
      // A marker that cannot be written only delays the work to the next ingest.
    }
  }

  const settings = {
    now: options.now ?? (() => new Date()),
    // The clock a slice or a tick is bounded by, in milliseconds. Injected so a
    // test can make a bound a count of readings rather than the runner's wall
    // time: two clock tests failed once on a slow CI runner (0.12.0). Never the
    // timestamps' clock (`now` above), which stays a Date.
    clock: typeof options.clock === "function" ? options.clock : () => Date.now(),
    markWork,
    // The time one backfill slice and one drain slice may take (0.11 review R6):
    // read as functions so a test (or an operator) can set them.
    backfillSliceMs: typeof options.backfillSliceMs === "function" ? options.backfillSliceMs : () => (Number.isFinite(options.backfillSliceMs) ? options.backfillSliceMs : BACKFILL_SLICE_MS),
    drainSliceMs: typeof options.drainSliceMs === "function" ? options.drainSliceMs : () => (Number.isFinite(options.drainSliceMs) ? options.drainSliceMs : DRAIN_SLICE_MS),
    // The engine's mode (S3a, docs/design/s3-engine-plan.md §1): off by default.
    // With off nothing is numbered, hashed or laned, so a space's event rows are
    // exactly what 0.13.0 wrote. A bad value is a startup refusal, never a
    // silent off (records/src/engine/flag.js).
    engine: options.engine ?? engineMode(process.env),
    // Internal server/test seam only. No production adapter is installed, no
    // environment or request field enables it, and backfill never calls it.
    // D2B must validate source capabilities/creation/order and retention policy
    // before passing any DTO to Silver. Baseline normalization is not that proof.
    silverIngest: installedSilver(options),
    onSilverDelta: typeof options.onSilverDelta === "function" ? options.onSilverDelta : null,
    // The ready index's one writer (S3a, design §10.5): a space with work says so
    // in `spaces/<id>.ready`, and only when that is news.
    acquireSpace: (spaceId) => store.acquireSpace(spaceId),
    forgetMeta: (spaceId) => forgetMeta(spaceId),
    markReady: (spaceId, state) => {
      if (!SPACE_ID.test(spaceId)) return
      touchReady(spacesDir, spaceId, state)
    },
    eventRetentionDays: options.eventRetentionDays ?? 30,
    proposalTtlDays: options.proposalTtlDays ?? 30,
    heldReceiptKey: typeof options.heldReceiptKey === "string" && Buffer.byteLength(options.heldReceiptKey) >= 32 ? options.heldReceiptKey : "",
    // Derives each purge entry's salt, so the salt is never in the space file (docs/design/forget-erase.md).
    forgetSecret: forgetSecretOf(options.forgetSecret),
    // One warning per code per store, for a condition every call would repeat.
    warnOnce: (() => {
      const said = new Set()
      return (code, message) => {
        if (said.has(code)) return
        said.add(code)
        ;(options.log?.warn ?? ((line) => console.warn(line)))(message)
      }
    })(),
    receiptTtlMs: Number.isInteger(options.receiptTtlMs) && options.receiptTtlMs > 0 ? options.receiptTtlMs : RECEIPT_TTL_MS,
    receiptMax: Number.isInteger(options.receiptMax) && options.receiptMax > 0 ? options.receiptMax : RECEIPT_MAX,
    // Verified-caller grants (docs/design/adr-verified-caller-grants.md):
    // `actKeys` is the key-file loader (action-grant-keys.js) or null; `acts`
    // is the act handlers this build applies (acts.js), and `actsEnabled` the
    // operator's switch. Both empty by default: the door is dark.
    actKeys: options.actKeys ?? null,
    // The shared reservation key (docs/design/p2-control.md): with it, a
    // control-plane act's reservation answers a proof the gateway and control
    // verify. Absent, no proof is issued and no control-plane act can be
    // pressed from a host's page.
    p2Key: Buffer.isBuffer(options.p2Key) ? options.p2Key : null,
    actAudience: typeof options.actAudience === "string" && options.actAudience ? options.actAudience : GRANT_AUDIENCE,
    // Every act this build applies is checked as the service opens, so a
    // declaration a grant could never meet (an unknown class, an async `run`)
    // stops start-up instead of failing open on the first act.
    acts: (() => {
      const acts = options.acts instanceof Map ? options.acts : new Map()
      for (const [name, definition] of acts) assertAct(name, definition)
      return acts
    })(),
    actsEnabled: new Set(Array.isArray(options.actsEnabled) ? options.actsEnabled : []),
    // The core erase a person-level erasure calls (records/src/person-core.js),
    // or null when this cell has no core configured.
    personCore: typeof options.personCore === "function" ? options.personCore : null,
    // The person's own audit and knowledge rows, alone (person.erase-core):
    // its own step, so a slow core never holds the rest of an erasure.
    personRows: typeof options.personRows === "function" ? options.personRows : null,
    // An operator's acknowledgement of a rollback over a space that holds
    // claims (S2 review, M6): the claims layer's build guard reads it.
    claimsRollbackAck: options.claimsRollbackAck ?? process.env.RECORDS_CLAIMS_ROLLBACK_ACK,
  }
  /** @type {Map<string, Handle>} */
  const handles = new Map()
  /** The spaces a drain is running in, so one process never drains a space twice at once (0.11 review R7). */
  const working = new Set()
  /** Which space a tick starts from, so no space is starved by the tick's cap. */
  let rotation = 0
  /** One SpaceStore per space id, so a caller always gets the same object. */
  const spaces = new Map()
  let empty = null
  let closed = false
  /** The job runner's listener for a written meeting page (0.11): one subscriber. */
  let meetingListener = null
  /** Whether meeting proposals are on: while off, a save leaves no mark (round 10). */
  // A cell that keeps more files open than the process may is a service that
  // fails at the worst moment (plan §4, design §10.5): say so at start, once.
  const openSoftLimit = Number(options.openLimit ?? process.report?.getReport?.()?.userLimits?.open_files?.soft ?? 0) || 0
  if (openSoftLimit > 0 && maxOpen * 3 > openSoftLimit) {
    settings.warnOnce("open_limit", `records: RECORDS_MAX_OPEN is ${maxOpen}, and this process may open ${openSoftLimit} files: keep ulimit -n at three times maxOpen (${maxOpen * 3})`)
  }

  let meetingEnabled = false

  function fileFor(spaceId) {
    return path.join(spacesDir, `${spaceId}.db`)
  }

  function emptyHandle() {
    if (!empty) empty = new Handle(openDatabase(":memory:"), null, true)
    return empty
  }

  /** The space's handle; null when its file does not exist and `create` is false. */
  function handleFor(spaceId, create) {
    if (closed) throw new Error("records: the store is closed")
    const open = handles.get(spaceId)
    if (open) {
      handles.delete(spaceId)
      handles.set(spaceId, open)
      return open
    }
    const file = fileFor(spaceId)
    if (!create && !fs.existsSync(file)) return null
    fs.mkdirSync(spacesDir, { recursive: true })
    const handle = new Handle(openDatabase(file), file)
    // A file that holds claims was written by a build that knows the claims
    // tables. A build that does not know them cannot scrub them on erasure, so
    // it refuses until the operator acknowledges the rollback.
    checkClaimsBuild(handle, { env: { RECORDS_CLAIMS_ROLLBACK_ACK: settings.claimsRollbackAck } })
    handles.set(spaceId, handle)
    while (handles.size > maxOpen) {
      const [oldest, evicted] = handles.entries().next().value
      handles.delete(oldest)
      // A handle a caller holds is marked, not closed (review M5): its holder is
      // between two statements, and the last release closes it.
      if (evicted.users > 0) evicted.evicted = true
      else evicted.close()
    }
    return handle
  }

  /**
   * The meta cache (plan §4, decision 1): a space's meta, keyed by the change
   * time of its file **and** its WAL, so a write — which lands in the WAL — makes
   * the entry stale, and the tick does not open a file nobody changed.
   */
  const metaCache = new Map()
  /**
   * Whether this filesystem keeps sub-second times. A coarse one (a second's
   * granularity) cannot tell two writes apart, so the meta cache is not used
   * there (review L): the file is read instead.
   */
  let fineTimes = null
  const keepsFineTimes = () => {
    if (fineTimes !== null) return fineTimes
    try {
      const probe = path.join(spacesDir, ".time-probe")
      fs.mkdirSync(spacesDir, { recursive: true })
      fs.writeFileSync(probe, "1")
      const when = new Date(1_700_000_000_123)
      fs.utimesSync(probe, when, when)
      fineTimes = fs.statSync(probe).mtimeMs % 1000 === 123
      fs.rmSync(probe, { force: true })
    } catch {
      fineTimes = false
    }
    return fineTimes
  }
  const changeKeyOf = (file) => {
    try {
      const main = fs.statSync(file)
      const wal = fs.existsSync(`${file}-wal`) ? fs.statSync(`${file}-wal`) : null
      return `${main.mtimeMs}:${main.size}:${wal ? `${wal.mtimeMs}:${wal.size}` : "-"}`
    } catch {
      return null
    }
  }

  /** A space's meta without keeping its file open, or null when it has no file. */
  function readMeta(spaceId) {
    const open = handles.get(spaceId)
    if (open) return metaOf(spaceId, open.all("select key, value from meta"))
    const key = keepsFineTimes() ? changeKeyOf(fileFor(spaceId)) : null
    const cached = key === null ? null : metaCache.get(spaceId)
    if (cached && cached.key === key) return cached.meta
    const file = fileFor(spaceId)
    if (!fs.existsSync(file)) return null
    const db = new DatabaseSync(file)
    try {
      db.exec("pragma busy_timeout = 5000")
      // A file that holds claims was written by a build that knows the claims
      // tables; a build that does not cannot scrub them on erasure (review M6).
      checkClaimsBuild(db, { env: { RECORDS_CLAIMS_ROLLBACK_ACK: settings.claimsRollbackAck } })
      const meta = metaOf(spaceId, db.prepare("select key, value from meta").all())
      if (key !== null) metaCache.set(spaceId, { key, meta })
      return meta
    } finally {
      db.close()
    }
  }

  const personalSpaceFor = personalSpaceResolver({ readMeta, spaceIds: () => store.spaceIds() })

  function forgetMeta(spaceId) {
    metaCache.delete(spaceId)
  }

  function release(spaceId) {
    const handle = handles.get(spaceId)
    if (handle) {
      handles.delete(spaceId)
      handle.close()
    }
    forgetMeta(spaceId)
  }

  const store = {
    dataDir,
    spacesDir,
    /** What `space.stats` and `/health` advertise about keyed writes. */
    idempotentReplay() {
      return replayCapability(settings)
    },
    /** A space's store. Throws 400 `invalid_space` for an id outside `^[A-Za-z0-9_.-]{1,128}$`. */
    forSpace(spaceId) {
      if (typeof spaceId !== "string" || !SPACE_ID.test(spaceId)) {
        throw invalid("invalid_space", "The space id is missing or not valid.", "Send x-records-space as 1 to 128 letters, digits, dots, hyphens or underscores. The gateway sets it.")
      }
      let space = spaces.get(spaceId)
      if (!space) {
        space = new SpaceStore({
          spaceId,
          settings,
          handleFor,
          emptyHandle,
          release,
          fileFor,
          readMeta,
          personalSpaceFor,
          // A written meeting page tells the job runner, which proposes from it
          // on its next tick (0.11, opencode-mem#58 item 2). One listener: the
          // runner's, and no page text crosses it.
          meetingWritten: ({ spaceId: written, path }) => {
            try {
              meetingListener?.({ spaceId: written, path })
            } catch {
              // A listener's failure never fails the person's write.
            }
          },
          meetingEnabled: () => meetingEnabled,
        })
        spaces.set(spaceId, space)
      }
      return space
    },
    /**
     * The engine's handle for one space (S3a): the same handle a write uses, and
     * the LRU's, so a batch reads, releases and reopens through one seam
     * (`docs/design/s3-engine-plan.md` §3: the handle is never held across a
     * model's await). `create: false` answers null when the space has no file.
     */
    /**
     * Let go of a space's handle (S3b): one records process keeps an LRU, and a
     * lease that is about to wait on the model must not hold a file open while
     * another space needs the slot (`docs/design/s3-engine-plan.md` §3).
     */
    releaseSpace(spaceId) {
      if (typeof spaceId !== "string" || !SPACE_ID.test(spaceId)) return
      // An unpaired release is a no-op (review M5): only the release its own
      // acquire returned may close a handle, so a caller that never held one
      // cannot eat a holder's count.
      const handle = handles.get(spaceId)
      if (handle && handle.users > 0) return
      release(spaceId)
    },
    /**
     * Take a space's handle across an await: `{handle, release}`, and `release`
     * works once. The count is what keeps a forget's handle alive across its
     * cascade's await while the engine lets go of the same file (review M5).
     */
    acquireSpace(spaceId, { create = false } = {}) {
      if (typeof spaceId !== "string" || !SPACE_ID.test(spaceId)) {
        throw invalid("invalid_space", "The space id is missing or not valid.", "Send the space id as 1 to 128 letters, digits, dots, hyphens or underscores. The gateway sets it.")
      }
      const handle = handleFor(spaceId, create)
      if (!handle) return { handle: null, release: () => {} }
      handle.users += 1
      let released = false
      const releaseToken = () => {
        if (released) return
        released = true
        handle.users -= 1
        // The last release of a handle the LRU evicted closes **that** handle,
        // and takes the slot only if the slot still holds it: a space reopened
        // while the holder was away keeps its new handle (review M5).
        if (handle.users === 0 && handle.evicted) {
          if (handles.get(spaceId) === handle) handles.delete(spaceId)
          handle.close()
        }
      }
      return { handle, release: releaseToken }
    },
    /** Whether this filesystem's times are fine enough to cache meta by (review L). */
    metaCacheable() {
      return keepsFineTimes()
    },
    /** How many space files this store holds open, for a leak check. */
    openHandles() {
      return handles.size
    },
    spaceHandle(spaceId, { create = false } = {}) {
      if (typeof spaceId !== "string" || !SPACE_ID.test(spaceId)) {
        throw invalid("invalid_space", "The space id is missing or not valid.", "Send the space id as 1 to 128 letters, digits, dots, hyphens or underscores. The gateway sets it.")
      }
      return handleFor(spaceId, create)
    },
    /**
     * The job runner's one listener for a written meeting page: `({spaceId,
     * path})`. It is how a save reaches the proposer without the store knowing
     * anything about the job runner, and without a page scan on every tick.
     */
    setMeetingListener(fn) {
      meetingListener = typeof fn === "function" ? fn : null
    },
    /**
     * The job runner's switch (0.11, round 10). While meeting proposals are
     * **off**, a saved page leaves no pending mark: nothing waits, no space is
     * opened, and switching on later proposes only from saves made after it.
     * A **delete** always marks, so its proposals are still withdrawn.
     */
    setMeetingEnabled(on) {
      meetingEnabled = on === true
    },
    /** Every space that has a file, with its meta: `[{space, team, space_kind, owner_user, service}]`. */
    async listSpaces() {
      return this.spaceIds()
        .map((spaceId) => readMeta(spaceId))
        .filter(Boolean)
    },
    /** Retention for every space: expired events, proposals and keyed-write receipts. Returns the totals. */
    async maintainAll() {
      const total = { spaces: 0, events: 0, proposals: 0, receipts: 0, grants: 0 }
      for (const spaceId of this.spaceIds()) {
        // Give the loop back between spaces: a sweep over many spaces must not
        // run without yielding (0.11 review R7-L3).
        await new Promise((resolve) => setImmediate(resolve))
        const done = await this.forSpace(spaceId).maintain()
        total.spaces += 1
        total.events += done.events
        total.proposals += done.proposals
        total.receipts += done.receipts ?? 0
        total.grants += done.grants ?? 0
      }
      return total
    },
    /**
     * One slice of the removals a space is still finishing — its index, then its
     * pending retractions — or `{skipped: "busy"}` when this space is already
     * being worked in this process (0.11 review R7). The collector's own drain
     * and this one are safe beside each other: every change commits in one
     * transaction with the flag it clears, so nothing is done twice, and a crash
     * leaves the work pending.
     */
    async drainSpace(spaceId, options = {}) {
      if (!SPACE_ID.test(spaceId)) return { skipped: "unknown" }
      if (working.has(spaceId)) return { skipped: "busy" }
      working.add(spaceId)
      try {
        const space = this.forSpace(spaceId)
        const done = await space.workSlice(options)
        markWork(spaceId, done.work)
        return done
      } catch (error) {
        return { error: String(error?.message ?? error).slice(0, 200) }
      } finally {
        working.delete(spaceId)
      }
    },
    /**
     * One worker tick: every space that left work behind, a bounded slice each.
     * The timer that calls it lives in the records service (server.js), not here.
     */
    async drainOnce(options = {}) {
      const started = settings.clock()
      // A space whose drain throws is skipped for the rest of the tick, and its
      // error logged once (0.11 review R8-S1).
      const failed = new Set()
      const logOnce = (spaceId, error) => settings.warnOnce(`removals:${spaceId}`, `records: removals could not drain ${spaceId}: ${String(error).slice(0, 200)}`)
      const cap = Number.isFinite(options.maxTickMs) ? options.maxTickMs : REMOVAL_TICK_MS
      const done = { spaces: [], slices: 0, records: 0 }
      // Slices of about 150 ms, one per space, until a tick's own cap or no
      // work: a 10,000-record backlog then finishes in a few minutes, and the
      // loop never holds the process longer than a tick.
      for (let round = 0; round < 100; round += 1) {
        if (!fs.existsSync(spacesDir)) break
        const spaces = fs
          .readdirSync(spacesDir)
          .filter((name) => name.endsWith(".work"))
          .map((name) => name.slice(0, -".work".length))
          .filter((space) => SPACE_ID.test(space))
          .sort()
        if (spaces.length === 0) break
        // Rotate the start: a tick cut short by its cap must not starve the
        // spaces after the first (0.11 review R8-B3).
        const turn = (rotation += 1) % spaces.length
        const order = [...spaces.slice(turn), ...spaces.slice(0, turn)]
        let progressed = false
        for (const spaceId of order) {
          // The cap is checked before each slice, and the loop is handed back
          // between them, so a request never waits for a whole tick (R8-B3).
          if (settings.clock() - started >= cap) return done
          await new Promise((resolve) => setImmediate(resolve))
          const answer = await store.drainSpace(spaceId, options)
          if (answer?.skipped === "busy") continue
          if (answer?.error) {
            if (!failed.has(spaceId)) logOnce(spaceId, answer.error)
            continue
          }
          progressed = true
          if (!done.spaces.includes(spaceId)) done.spaces.push(spaceId)
          done.slices += 1
          done.records += Number(answer?.records ?? 0)
        }
        if (!progressed) break
      }
      return done
    },
    /** The space ids that have a file. */
    spaceIds() {
      if (!fs.existsSync(spacesDir)) return []
      return fs
        .readdirSync(spacesDir)
        .filter((name) => name.endsWith(".db"))
        .map((name) => name.slice(0, -3))
        .filter((space) => SPACE_ID.test(space))
        .sort()
    },
    close() {
      closed = true
      for (const handle of handles.values()) handle.close()
      handles.clear()
      if (empty) empty.close()
      empty = null
    },
  }
  return store
}

/**
 * The person's own personal space, resolved once per person and then cached: a
 * capture from a shared space must not open every space's file on each call
 * (DESIGN §15.1, B8 rework). The current space is checked first, so the common
 * personal-space call reads one meta and no directory at all.
 *
 * @param {{ readMeta: (spaceId: string) => ({space_kind?: string, owner_user?: string} | null), spaceIds: () => string[] }} input
 * @returns {(user: string, currentSpaceId: string) => string | null}
 */
export function personalSpaceResolver({ readMeta, spaceIds }) {
  const cache = new Map()
  return (user, currentSpaceId) => {
    if (cache.has(user)) return cache.get(user)
    const own = readMeta(currentSpaceId)
    if (own?.space_kind === "personal" && own.owner_user === user) {
      cache.set(user, currentSpaceId)
      return currentSpaceId
    }
    let found = null
    for (const spaceId of spaceIds()) {
      if (spaceId === currentSpaceId) continue
      const meta = readMeta(spaceId)
      if (meta?.space_kind === "personal" && meta.owner_user === user) {
        found = spaceId
        break
      }
    }
    cache.set(user, found)
    return found
  }
}

// ---------------------------------------------------------------------------
// Keyed writes (docs/design/records-idempotency.md)

/** The capability `space.stats` and `/health` advertise. */
function replayCapability(settings) {
  return { version: REPLAY_VERSION, methods: [...REPLAY_METHODS], window_seconds: Math.floor(settings.receiptTtlMs / 1000) }
}

/** JSON with every object's keys sorted, so a digest does not depend on key order. */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`
  if (value && typeof value === "object") {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

/**
 * The digest a key is bound to: the method and the request without the key,
 * the attempt's age and `base_version` (top level and in `record`). The
 * version is left out because a re-executed tool call reads the state its own
 * first attempt produced and rebuilds only that.
 */
export function writeDigest(method, body) {
  const { idempotency_key: _key, idempotency_age_ms: _age, base_version: _version, ...rest } = body ?? {}
  if (isPlainObject(rest.record)) {
    const { base_version: _recordVersion, ...record } = rest.record
    rest.record = record
  }
  return sha256(canonicalJson({ v: REPLAY_VERSION, method, body: rest }))
}

/**
 * The history note of a record created as a move or copy from another space
 * (fields.moved_from or copied_from, 0.9.7): where it says it came from, by
 * id. Any writer can send these fields, so the note is a claim, marked
 * `verified: false`, never a fact the store checked.
 */
function provenanceNote(fields) {
  for (const key of ["moved_from", "copied_from"]) {
    const from = fields?.[key]
    if (!isPlainObject(from) || typeof from.space !== "string" || typeof from.id !== "string") continue
    const space = from.space.slice(0, 200)
    const id = from.id.slice(0, 200)
    return { [key]: { space, id, version: Number.isInteger(from.version) ? from.version : null, verified: false }, reason: `says it was ${key === "moved_from" ? "moved" : "copied"} from ${space} (${id}); not verified` }
  }
  return {}
}

/** What a receipt keeps of a write's result: ids, versions and counts, never content. */
function receiptOf(result) {
  const ref = (record) => (record && typeof record.id === "string" ? { id: record.id, version: Number(record.version) } : undefined)
  const receipt = {}
  if (result?.record) receipt.record = ref(result.record)
  if (typeof result?.created === "boolean") receipt.created = result.created
  if (Array.isArray(result?.superseded)) {
    if (result.superseded.length) receipt.superseded = result.superseded.filter((id) => typeof id === "string")
  } else if (result?.superseded) {
    receipt.superseded_record = ref(result.superseded)
  }
  if (Array.isArray(result?.deleted)) {
    receipt.deleted = result.deleted
    receipt.missing = Array.isArray(result.missing) ? result.missing : []
    receipt.links_removed = Number(result.links_removed) || 0
  }
  if (Array.isArray(result?.moved)) receipt.moved = result.records.map(ref).filter(Boolean)
  if (Array.isArray(result?.rewritten)) {
    receipt.rewritten = result.rewritten
    receipt.rewritten_links = Number(result.rewritten_links) || 0
  }
  // A batch revise: each id's outcome (status, version, error code and its
  // fixed message), which holds no record content.
  if (Array.isArray(result?.results)) {
    receipt.action = result.action
    receipt.results = result.results
    if (result.links_removed !== undefined) receipt.links_removed = Number(result.links_removed) || 0
  }
  // A forget's purge entry id and a version purge's count: ids and numbers only.
  if (typeof result?.purge_id === "string") receipt.purge_id = result.purge_id
  if (Number.isInteger(result?.versions_removed)) receipt.versions_removed = result.versions_removed
  return receipt
}

/** Thrown inside a write's transaction when another process committed the same key first: the write rolls back. */
class KeyRaced extends Error {
  constructor(prior) {
    super("records: the key was committed by another writer")
    this.prior = prior
  }
}

// ---------------------------------------------------------------------------
// Rows and records

/** The meta a space's file records, in the shape `meta()` answers. */
function metaOf(spaceId, rows) {
  const meta = Object.fromEntries(rows.map((row) => [row.key, row.value]))
  return {
    space: spaceId,
    team: meta.team ?? null,
    space_kind: meta.space_kind ?? null,
    owner_user: meta.owner_user ?? null,
    service: meta.service ?? null,
  }
}

/** A person's write to a journal page locks it against the routines (contract §2.4). */
function markJournal(record, actor) {
  if (typeof record.path === "string" && record.path.startsWith("journal/") && actor.user !== ROUTINE_USER) {
    record.fields = { ...record.fields, edited: true }
  }
  return record
}

function text(value) {
  return value === undefined || value === null ? null : String(value)
}

/** The pages placed in the pinned block of every session (the plugin's src/tools/shared.js PINNED_PAGES). */
const PINNED_PAGES = Object.freeze(["index"])

/**
 * An answer that says when a claimed `stated_by: person` was stored as
 * `agent` (mayStatePerson): the caller learns its claim was not kept.
 */
function withProvenance(claimed, answer) {
  const stored = answer?.record?.stated_by
  if (claimed !== "person" || !stored || stored === "person") return answer
  return { ...answer, provenance: { claimed: "person", stored, reason: PERSON_CLAIM_REASON } }
}

/** A held batch's answer when a record in it claimed `person` and was stored as `agent`. */
function heldProvenance(records, actor) {
  if (mayStatePerson(actor) || !records.some((record) => isPlainObject(record) && record.stated_by === "person")) return {}
  return { provenance: { claimed: "person", stored: "agent", reason: PERSON_CLAIM_REASON } }
}

/** How a decider was established: a browser session of the console, a person's grant, the routines, or any bearer. */
function decidedVia(actor) {
  if (actor.user === ROUTINE_USER) return "routine"
  if (actor.grant) return "grant"
  return actor.credential === "session" ? "session" : "bearer"
}

function parse(text, fallback) {
  if (text === null || text === undefined) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** A stored row as the internal record: the API shape plus `change`. */
function fromRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    type: row.type,
    path: row.path ?? null,
    title: row.title,
    body: row.body,
    status: row.status,
    stated_by: row.stated_by,
    fields: parse(row.fields, {}),
    supersedes: parse(row.supersedes, []),
    superseded_by: row.superseded_by ?? null,
    source: parse(row.source, {}),
    task: row.task ?? null,
    author: { user: row.author_user ?? null, agent: row.author_agent ?? null },
    owner: row.owner ?? null,
    created: row.created,
    updated: row.updated,
    // A row stored before the version column existed, or imported with none,
    // reads as version 1 — the column's own default — so the list and the act
    // that checks it name the same revision (0.12.6 review).
    version: Number(row.version) > 0 ? Number(row.version) : 1,
    links: parse(row.links, []),
    change: parse(row.change, {}),
  }
}

/** The API shape (contract §2.3), keys in the contract's order. */
/**
 * A meeting proposal with its quoted text removed (0.11 re-review): a retired
 * or rejected proposal keeps its ids and where it pointed — the page, the
 * moment, the transcript file — and loses the words it quoted, in its title, its
 * body, its evidence and its payload. What a person refused is not kept in the
 * space by the review that refused it.
 */
export function scrubMeetingProposal(proposal) {
  const fields = proposal?.fields && typeof proposal.fields === "object" ? proposal.fields : {}
  const evidence = Array.isArray(fields.evidence)
    ? fields.evidence.map((entry) => {
        const kept = {}
        for (const key of ["record", "path", "at", "file"]) if (entry && entry[key] !== undefined) kept[key] = entry[key]
        return kept
      })
    : []
  const where = /\[meeting [^\]\n]{0,300}\]/.exec(String(proposal?.body ?? ""))?.[0] ?? ""
  const payload = fields.payload && typeof fields.payload === "object" ? { kind: fields.payload.kind ?? null, type: fields.payload.type ?? null } : undefined
  return {
    ...proposal,
    title: "withdrawn proposal",
    body: `Withdrawn; the words it quoted are not kept.${where ? ` ${where}` : ""}`,
    fields: { ...fields, evidence, ...(payload ? { payload } : {}) },
  }
}

function pub(record) {
  return {
    id: record.id,
    kind: record.kind,
    type: record.type,
    path: record.path,
    title: record.title,
    body: record.body,
    status: record.status,
    stated_by: record.stated_by,
    fields: record.fields,
    supersedes: record.supersedes,
    superseded_by: record.superseded_by,
    source: record.source,
    task: record.task,
    author: record.author,
    owner: record.owner,
    created: record.created,
    updated: record.updated,
    version: record.version,
    links: record.links,
  }
}

/** The list shape: the body cut to 500 characters unless `full`. */
function listed(record, full) {
  const out = pub(record)
  if (!full && out.body.length > LIST_BODY) {
    out.body = cut(out.body, LIST_BODY)
    out.body_clipped = true
  }
  return out
}

function searchExtra(fields) {
  const words = []
  if (Array.isArray(fields?.aliases)) words.push(...fields.aliases)
  if (Array.isArray(fields?.tags)) words.push(...fields.tags)
  return words.join(" ")
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function visibleRecord(actor, record) {
  return canRead(actor, record.path) && !(record.kind === "proposal" && record.type === "team_write" && record.author?.user !== actor.user)
}

function encodeCursor(values) {
  return Buffer.from(JSON.stringify(values)).toString("base64url")
}

function decodeCursor(cursor, size) {
  if (cursor === undefined || cursor === null || cursor === "") return null
  try {
    const values = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"))
    if (Array.isArray(values) && values.length === size && values.every((value) => typeof value === "string")) return values
  } catch {
    // fall through
  }
  throw invalid("invalid_cursor", "The cursor is not one this service gave out.", "Send the cursor from the previous answer unchanged, or leave it out to start from the beginning.")
}

function intInRange(value, name, min, max, fallback) {
  if (value === undefined || value === null) return fallback
  if (!Number.isInteger(value) || value < min || value > max) {
    throw invalid("invalid_request", `${name} must be a whole number from ${min} to ${max}.`, `Send ${name} between ${min} and ${max}.`)
  }
  return value
}

function stringList(value, name, allowed, max = 20) {
  if (value === undefined || value === null) return null
  const list = typeof value === "string" ? [value] : value
  if (!Array.isArray(list) || list.length === 0 || list.length > max || list.some((item) => typeof item !== "string")) {
    throw invalid("invalid_request", `${name} must be a list of up to ${max} strings.`, `Send ${name} as ["…"], or leave it out.`)
  }
  if (allowed) {
    const bad = list.find((item) => !allowed.includes(item))
    if (bad !== undefined) throw invalid("invalid_request", `"${bad}" is not a valid value of ${name}.`, `Use ${allowed.join(", ")}.`)
  }
  return [...new Set(list)]
}

function checkPrefix(prefix) {
  if (prefix === undefined || prefix === null || prefix === "") return null
  const bare = String(prefix).replace(/\/$/, "")
  if (!PATH.test(bare)) {
    throw invalid("invalid_path", `${JSON.stringify(prefix)} is not a path prefix.`, 'Send a page path or folder such as "projects" or "people/".')
  }
  return String(prefix)
}

/** SQL for "path is under prefix", by whole segment (as grants are matched). */
function prefixClause(prefix) {
  if (prefix.endsWith("/")) return { sql: "substr(path, 1, ?) = ?", params: [prefix.length, prefix] }
  return { sql: "(path = ? or substr(path, 1, ?) = ?)", params: [prefix, prefix.length + 1, `${prefix}/`] }
}

function placeholders(count) {
  return Array.from({ length: count }, () => "?").join(", ")
}

/** Statuses a read filter means: undefined → the default view, "all" → every status. */
function statusFilter(value, kinds) {
  if (value === undefined || value === null) {
    if (kinds && kinds.length === 1 && kinds[0] === "proposal") return ["proposed"]
    return DEFAULT_STATUSES
  }
  if (value === "all") return null
  if (value === "current") return DEFAULT_STATUSES
  return stringList(value, "status", STATUSES)
}

/**
 * The selection filters records.list and records.search take beside kind,
 * type, status and path (docs/design/records-selection.md). A list or search
 * answer names them in `filters`, so a client can tell a service that applies
 * them from one that ignores unknown keys.
 */
export const SELECTION_FILTERS = Object.freeze(["created_after", "created_before", "updated_after", "updated_before", "author_agent", "task", "stated_by", "source_session", "contains"])
const STATED_BY = ["person", "agent"]
const LIKE_ESCAPE = /[\\%_]/g

/** A date (the start of that UTC day) or a date-time, as the ISO the rows store. */
function isoBound(value, name) {
  if (value === undefined || value === null || value === "") return null
  if (typeof value !== "string" || !isDateOrDateTime(value)) {
    throw invalid("invalid_request", `${name} must be a date or a date-time.`, "Send it as 2026-11-08 or 2026-11-08T00:00:00Z.")
  }
  return value.length === 10 ? `${value}T00:00:00.000Z` : new Date(value).toISOString()
}

/** One value or a list of up to 20 strings of at most 200 characters each. */
function filterList(value, name) {
  const list = stringList(value, name)
  if (list && list.some((item) => !item.trim() || item.length > 200)) {
    throw invalid("invalid_request", `Each ${name} must be 1 to 200 characters.`, `Send ${name} as text, or leave it out.`)
  }
  return list
}

/**
 * Push the selection filters onto a query's where clause. `author_agent` takes
 * exact names, or a name ending in `*` for every agent that starts with it
 * ("eval-*"). `contains` is a case-insensitive substring of the title or body.
 */
function selectionClauses(body, where, params) {
  const bounds = [
    ["created_after", "created >= ?"],
    ["created_before", "created < ?"],
    ["updated_after", "updated > ?"],
    ["updated_before", "updated < ?"],
  ]
  for (const [name, sql] of bounds) {
    const bound = isoBound(body[name], name)
    if (bound) {
      where.push(sql)
      params.push(bound)
    }
  }
  const agents = filterList(body.author_agent, "author_agent")
  if (agents) {
    const parts = []
    for (const agent of agents) {
      if (agent.endsWith("*")) {
        const stem = agent.slice(0, -1)
        if (!stem) throw invalid("invalid_request", 'author_agent "*" matches every agent.', "Leave author_agent out to list every agent's records.")
        parts.push("author_agent like ? escape '\\'")
        params.push(`${stem.replace(LIKE_ESCAPE, "\\$&")}%`)
      } else {
        parts.push("author_agent = ?")
        params.push(agent)
      }
    }
    where.push(`(${parts.join(" or ")})`)
  }
  const tasks = filterList(body.task, "task")
  if (tasks) {
    where.push(`task in (${placeholders(tasks.length)})`)
    params.push(...tasks)
  }
  const stated = stringList(body.stated_by, "stated_by", STATED_BY)
  if (stated) {
    where.push(`stated_by in (${placeholders(stated.length)})`)
    params.push(...stated)
  }
  const sessions = filterList(body.source_session, "source_session")
  if (sessions) {
    where.push(`json_extract(source, '$.session') in (${placeholders(sessions.length)})`)
    params.push(...sessions)
  }
  if (body.contains !== undefined && body.contains !== null && body.contains !== "") {
    if (typeof body.contains !== "string" || !body.contains.trim() || body.contains.length > 200) {
      throw invalid("invalid_request", "contains must be text of 1 to 200 characters.", "Send a word or phrase the title or body holds.")
    }
    where.push("(title like ? escape '\\' or body like ? escape '\\')")
    const pattern = `%${body.contains.trim().replace(LIKE_ESCAPE, "\\$&")}%`
    params.push(pattern, pattern)
  }
}

/** Text fields of a record a person reads, besides its title and body. */
const TEXT_FIELDS = ["what", "trigger", "owner", "link"]

/**
 * What may be stored (owner decision D3', src/storable.js, the plugin's copy):
 * a routine's write is automatic, so each line holding a secret is withheld
 * and emails and local paths are masked, in place; every other write is
 * explicit and is refused (422 `refused`) when it holds a secret or a
 * person's email address (reason `secret`, `email`). A memory is checked by
 * its curation refusals, in 0.9.5's order (status, instruction, secret,
 * email, local path); a page or a commitment keeps a home-directory path.
 */
function curate(record, actor) {
  if (actor?.user === ROUTINE_USER) {
    for (const key of ["title", "body"]) {
      if (typeof record[key] === "string" && record[key]) record[key] = storable(record[key], "routine").text
    }
    if (isPlainObject(record.fields)) {
      for (const key of TEXT_FIELDS) {
        if (typeof record.fields[key] === "string" && record.fields[key]) record.fields = { ...record.fields, [key]: storable(record.fields[key], "routine").text }
      }
    }
  } else if (record.kind !== "memory") {
    refuseUnstorable([record.title, record.body, ...TEXT_FIELDS.map((key) => record.fields?.[key])], record.kind === "commitment" ? "commitment" : "page")
  }
  if (record.kind !== "memory") return
  const verdict = refusal([record.title, record.body].filter(Boolean).join("\n"))
  if (verdict) throw refused(verdict.message, verdict.next, { reason: verdict.reason })
}

/** Refuse an explicit write that holds a secret or a person's email address (owner decision D3'). */
function refuseUnstorable(texts, path) {
  const verdict = unstorable(texts.filter((text) => typeof text === "string" && text).join("\n"), path)
  if (verdict) throw refused(verdict.message, verdict.next, { reason: verdict.reason })
}

/**
 * One identity added to a page's `fields.identities`: the same value adds
 * nothing, a different value for the same network is held beside the first, and
 * neither is ever dropped (J4 review, finding 1).
 */
function addIdentityValue(current, value) {
  if (current === undefined || current === null || current === "") return value
  const list = Array.isArray(current) ? current.filter((entry) => typeof entry === "string") : [String(current)]
  return [...new Set([...list, value])]
}

/** The approval excerpt is derived from the proposed body, never caller-supplied metadata. */
function heldPreview(value) {
  let text = String(value ?? "")
  for (const [pattern, replacement] of [
    [/\b(authorization|x-api-key)\b["']?(\s*[:=]\s*)[^\r\n,;]+/gi, "$1$2[redacted]"],
    [/\b(api[_-]?key|access[_-]?token|refresh[_-]?token|token|password|passwd|secret)\b["']?(\s*[:=]\s*)(?:"[^"\n]*"|'[^'\n]*'|[^\s,;]+)/gi, "$1$2[redacted]"],
    [/\bBearer\s+[A-Za-z0-9._~+/=-]{3,}/gi, "Bearer [redacted]"],
    [/\bsk-[A-Za-z0-9_-]{6,}/g, "[redacted-key]"],
    [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{8,}\b/g, "[redacted-token]"],
  ]) text = text.replace(pattern, replacement)
  text = text.replace(/\s+/g, " ").trim()
  return text.length > 400 ? `${text.slice(0, 399)}…` : text
}

function signHeldReceipt(key, payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac("sha256", key).update(encoded).digest("base64url")
  return `${encoded}.${signature}`
}

/** A commitment's due date as an act may set it: a day, or a date-time with an offset. */
function actDue(value) {  if (!isDateOrDateTime(value)) {
    throw invalid("invalid_record", "A due date is YYYY-MM-DD or a date-time with an offset.", "Send a day, or a time such as 2026-11-14T09:00:00+01:00.")
  }
  return value
}

/** The page type a new page at this path takes: its first segment when that names one, else `topic`. */
function pageTypeOf(pagePath) {
  const first = String(pagePath).split("/")[0]
  return KINDS.page.includes(first) ? first : "topic"
}

/** The payload a proposed record applies, with the person's edited words (A10's Edit). */
function editedPayload(proposal, text) {  if (typeof text !== "string" || !text.trim()) {
    throw invalid("invalid_record", "An edit needs the corrected words.", "Send text as the record the person keeps.")
  }
  const payload = isPlainObject(proposal.fields?.payload) ? proposal.fields.payload : {}
  return { ...payload, body: text }
}

function validHeldReceipt(key, receipt, expected) {
  if (!key || typeof receipt !== "string" || receipt.length > 2048) return false
  const parts = receipt.split(".")
  if (parts.length !== 2) return false
  const signature = createHmac("sha256", key).update(parts[0]).digest()
  let given, payload
  try { given = Buffer.from(parts[1], "base64url"); payload = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) } catch { return false }
  return given.length === signature.length && timingSafeEqual(given, signature) && JSON.stringify(payload) === JSON.stringify(expected)
}

function requireObject(input, method) {
  if (input === undefined || input === null) return {}
  if (!isPlainObject(input)) throw invalid("invalid_body", `${method} takes a JSON object.`, "Send the body as {…}.")
  return input
}

/** A local day, `YYYY-MM-DD`, as the routines key a read mark. */
function requireDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid("invalid_day", "day must be YYYY-MM-DD.", "Send the local day the units belong to, such as 2026-11-10.")
  return value
}

function requireId(id, name = "id") {
  if (typeof id !== "string" || !RECORD_ID.test(id)) {
    throw invalid("invalid_id", `${name} must be a record id (rec_ and 26 characters).`, "Use an id from a previous answer, such as the one records.put returned.")
  }
  return id
}

/** The longest line `memory.saveLine` keeps: one sentence or two, not a transcript. */
const LINE_CHARS = 4_000
/** The longest value one part of a saved line's citation may carry. */
const LINE_SOURCE_CHARS = 200
/** Where a saved line came from: the conversation, the line in it, who wrote it, and when. */
const LINE_SOURCE_KEYS = Object.freeze(["conversation", "line", "author", "at"])

/**
 * The citation a saved line must carry (`memory.saveLine`'s `from`): the
 * conversation and the line are required, and the author and time are kept when
 * they are given. Nothing else is accepted, so a caller cannot put words in a
 * source field a read would then show as where the record came from.
 */
function requireLineSource(from) {
  if (!isPlainObject(from)) throw invalid("invalid_request", "A saved line names where it came from.", 'Send from: {conversation, line, author, at}.')
  const extra = Object.keys(from).filter((key) => !LINE_SOURCE_KEYS.includes(key))
  if (extra.length > 0) throw invalid("invalid_request", `from does not accept ${extra.map((key) => JSON.stringify(key)).join(", ")}.`, `Send only ${LINE_SOURCE_KEYS.join(", ")}.`)
  const out = {}
  for (const key of LINE_SOURCE_KEYS) {
    const value = from[key]
    if (value === undefined || value === null || value === "") continue
    if (typeof value !== "string") throw invalid("invalid_request", `from.${key} must be text.`, "Send it as text.")
    const trimmed = value.trim()
    if (!trimmed) continue
    if (trimmed.length > LINE_SOURCE_CHARS) throw invalid("invalid_request", `from.${key} is longer than ${LINE_SOURCE_CHARS} characters.`, "Send the line's own id and conversation, not a transcript.")
    out[key] = trimmed
  }
  for (const key of ["conversation", "line"]) {
    if (!out[key]) throw invalid("invalid_request", `from.${key} names where the line came from, so it is required.`, "Send from: {conversation, line}, as the conversation and the line's own id.")
  }
  return out
}

/** The id of a wiki, as the knowledge service makes one: `wiki-…` or a records wiki. */
function requireWikiId(value) {
  const text = typeof value === "string" ? value.trim() : ""
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{2,127}$/.test(text)) {
    throw invalid("invalid_request", `${JSON.stringify(value ?? null)} is not a wiki id.`, 'Send wiki: "<wiki id>" from mem_wiki list, or leave it out.')
  }
  return text
}

/** An optional one-line piece of text: absent or null is null; anything else must be text within `max`. */
function optionalText(value, field, max) {
  if (value === undefined || value === null) return null
  if (typeof value !== "string") throw invalid("invalid_request", `${field} must be text.`, `Send ${field} as a string, or leave it out.`)
  if (value.length > max) throw tooLarge(`${field} is ${value.length} characters; the limit is ${max}.`, `Shorten ${field}.`)
  return value
}

// ---------------------------------------------------------------------------
// The space store

/**
 * A routine run's own error text, and its summary's, redacted (0.11 review,
 * round 3). A model provider's error can quote a key or a URL with a token, and
 * `llm.js` carries the provider's words; the run's error is stored in the
 * ledger and shown by `listRuns`, `routines.status` and `space.stats`
 * `last_runs` (the console's Home, Spaces and Activity). Idempotent, so a row
 * written before this fix is redacted as it is read and a row this build wrote
 * is unchanged.
 */
function redactedRun(run) {
  if (!isPlainObject(run)) return run
  const next = { ...run }
  if (typeof next.error === "string" && next.error) next.error = errorText(next.error, 500)
  if (isPlainObject(next.result) && typeof next.result.error === "string" && next.result.error) next.result = { ...next.result, error: errorText(next.result.error, 500) }
  return next
}

export class SpaceStore {
  #spaceId
  #settings
  #handleFor
  #emptyHandle
  #release
  #fileFor
  #readMeta
  #personalSpaceFor
  #meetingWritten
  #meetingEnabled

  constructor({ spaceId, settings, handleFor, emptyHandle, release, fileFor, readMeta, personalSpaceFor, meetingWritten, meetingEnabled }) {
    // Every method is bound, so a detached call (const { put } = space) works,
    // as it does with the routines' in-memory double.
    for (const name of Object.getOwnPropertyNames(SpaceStore.prototype)) {
      if (name !== "constructor" && typeof this[name] === "function") this[name] = this[name].bind(this)
    }
    this.#spaceId = spaceId
    this.#readMeta = readMeta
    this.#personalSpaceFor = personalSpaceFor ?? (() => null)
    this.#settings = settings
    this.#handleFor = handleFor
    this.#emptyHandle = emptyHandle
    this.#release = release
    this.#fileFor = fileFor
    this.#meetingWritten = typeof meetingWritten === "function" ? meetingWritten : () => {}
    this.#meetingEnabled = typeof meetingEnabled === "function" ? meetingEnabled : () => false
  }

  /**
   * The job runner's listener: a meeting page was written (0.11,
   * opencode-mem#58 item 2). The pending row commits with the caller's write,
   * so a restart's first scan finds the page; the listener itself only saves a
   * tick of latency. It carries the path only — never the page's text.
   */
  #meetingPage(record) {
    if (record?.kind !== "page" || record?.type !== "meeting" || typeof record.path !== "string") return
    // Off: no mark, no space opened, and no backfill when it is switched on.
    if (!this.#meetingEnabled()) return
    const handle = this.#handleFor(this.#spaceId, false)
    if (handle) {
      handle.tx(() => markMeetingPending(handle, record.path, this.#nowIso()))
    }
    this.#meetingWritten({ spaceId: this.#spaceId, path: record.path, meetingId: record.id ?? null })
  }

  /**
   * A meeting page was deleted: its proposals must go with it (0.11 review,
   * should-fix 1). The pending row is written first, so the pass that withdraws
   * them runs even if this process restarts in between.
   */
  #meetingGone(record) {
    if (record?.kind !== "page" || record?.type !== "meeting" || typeof record.path !== "string") return
    const handle = this.#handleFor(this.#spaceId, false)
    if (handle) {
      handle.tx(() => markMeetingPending(handle, record.path, this.#nowIso()))
    }
    this.#meetingWritten({ spaceId: this.#spaceId, path: record.path, meetingId: record.id ?? null, deleted: true })
  }

  get spaceId() {
    return this.#spaceId
  }

  #nowIso() {
    return this.#settings.now().toISOString()
  }

  /** The handle to read from: the space's file, or an empty schema when there is none yet. */
  #reader() {
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return this.#emptyHandle()
    this.#maybeMaintain(handle)
    return handle
  }

  /** The handle to write to, creating the file; records the writer's space meta. */
  #writer(actor) {
    // The routines never create a space: a space purged during a run stays
    // gone (FABLE records #2), and its run ends with space_gone.
    const routine = actor?.user === ROUTINE_USER
    const systemWrite = routine || actor?.user === JOBS_USER
    const handle = this.#handleFor(this.#spaceId, !systemWrite)
    if (!handle) throw conflict("space_gone", "This space no longer exists; the routine wrote nothing.", "Nothing to do: the space was purged.")
    this.#stamp(handle, actor)
    this.#maybeMaintain(handle)
    return handle
  }

  /** The handle when the file exists, else null (writes that change existing data). */
  #existing(actor) {
    const handle = this.#handleFor(this.#spaceId, false)
    if (handle) {
      this.#stamp(handle, actor)
      this.#maybeMaintain(handle)
    }
    return handle
  }

  /**
   * Record the container, the core's service id, the space kind and a
   * personal space's owner in meta (contract §2.5). The kind and the owner are
   * kept from the first write that names them, and the owner is never the
   * routines' own user; the container and the service follow the gateway,
   * which resolves them on every request.
   */
  #stamp(handle, actor) {
    if (!actor || handle.empty) return
    if (!handle.meta) {
      handle.meta = Object.fromEntries(
        handle.all("select key, value from meta where key in ('team', 'service', 'space_kind', 'owner_user')").map((row) => [row.key, row.value]),
      )
    }
    const set = (key, value) => {
      handle.run("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", key, value)
      handle.meta[key] = value
      this.#settings.forgetMeta(this.#spaceId)
    }
    if (actor.team && handle.meta.team !== actor.team) set("team", actor.team)
    if (actor.service && handle.meta.service !== actor.service) set("service", actor.service)
    if (actor.spaceKind && !handle.meta.space_kind) set("space_kind", actor.spaceKind)
    if (handle.meta.space_kind === "personal" && !handle.meta.owner_user && actor.user && actor.user !== ROUTINE_USER && actor.user !== JOBS_USER) {
      set("owner_user", actor.user)
    }
  }

  #maybeMaintain(handle) {
    const now = this.#settings.now().getTime()
    if (now - handle.maintainedAt < MAINTAIN_EVERY_MS) return
    handle.maintainedAt = now
    this.#maintain(handle)
  }

  /**
   * The read marks of the units whose events are about to go (lane 0134, L).
   *
   * A mark names its unit as the routines' `unitKey` does: `source:thread`, or
   * `source:<event id>` for an event in no thread, and `meeting:<event id>` for
   * a meeting however it is threaded. An empty thread counts as no thread,
   * because `unitKey` reads `thread || ref`, so `nullif` keeps the two keys
   * equal for an event that reached records without the plugin's contract read
   * (lane 0135, L). Called inside the transaction that deletes the events, so
   * no mark outlives the events it is about: a unit taken away by a forget, an
   * erasure or an unbind, then collected again with the same ids, is unread,
   * and the daily reads it. Only the units whose events go lose their marks:
   * another thread of the same source keeps its own, so it is not read again
   * for nothing.
   */
  #dropMarksOf(handle, where, params) {
    if (!hasTable(handle, "unit_reads")) return
    handle.run(
      `delete from unit_reads where unit_key in (
         select case when kind = 'meeting' then 'meeting:' || id else source || ':' || coalesce(nullif(thread, ''), id) end
         from events ${where})`,
      ...params,
    )
  }

  /**
   * The trait gate's verdicts for the events about to go (lane 0198, review L).
   * A verdict is a hash of a title or a claim the event carried, and after a
   * forget nothing derived from the event may remain, so each row names the refs
   * it was reached for and goes when any of them does. A row covering other refs
   * too is lost with it; the next run judges the text that remains once more,
   * which costs one classifier call and hides nothing. Called inside the
   * transaction that deletes the events, before their rows are gone.
   */
  #dropTraitReadsOf(handle, where, params) {
    if (!hasTable(handle, "trait_reads")) return
    handle.run(
      `delete from trait_reads where exists (
         select 1 from json_each(coalesce(trait_reads.refs, '[]')) where value in (select id from events ${where}))`,
      ...params,
    )
  }

  /**
   * Drop events, expired proposals, agents unseen for 90 days, keyed-write
   * receipts past their window, and 0.9.1 create-ledger rows whose record is
   * gone.
   */
  #maintain(handle) {
    const now = this.#settings.now()
    const eventCutoff = new Date(now.getTime() - this.#settings.eventRetentionDays * 86_400_000).toISOString()
    const nowIso = now.toISOString()
    const done = handle.tx(() => {
      if (expireSilver(handle, nowIso).changed > 0) handle.erasePending = true
      // The index and the removals a paused or failing binding left behind are
      // finished here too, so nothing is stranded (0.11 review R6-B1, R6-S3).
      this.#citeBackfill(handle)
      const stranded = handle.all("select distinct source, account from events where retract_pending = 1")
      let retracted = 0
      if ((handle.get("select value from meta where key = 'cite_edges'")?.value ?? "") === "done") {
        const system = { user: ROUTINE_USER, agent: ROUTINE_USER, role: "owner", space: this.#spaceId }
        for (const row of stranded.slice(0, 20)) {
          const finished = this.#drainPending(handle, system, { source: row.source, account: row.account, nowIso })
          retracted += finished.records
        }
      }
      // A maintenance drain scrubs text as well, so it takes the WAL with it (R8-B1).
      if (retracted > 0) handle.erasePending = true
      // A read mark is about events; it goes when they do, so a day older than
      // the retention window is not queued for catch-up ever again. The marks
      // of the units this pass deletes go with them, whatever day they name: a
      // unit read late has a mark newer than its events.
      // The engine's own count comes first (S3a, design §10.5 I7): what the lane
      // never read, by source and lane, is counted before the rows go.
      if (engineOn(this.#settings.engine)) this.#countExpired(handle, { eventCutoff, nowIso })
      // A retry row is about one event: it goes with it, in this transaction, so
      // the retry set can never count what no lane can read (review M2).
      handle.run("delete from lane_retry where event_id in (select id from events where ingested_at < ?)", eventCutoff)
      this.#dropMarksOf(handle, "where ingested_at < ?", [eventCutoff])
      // A gate verdict names the events it was reached for: it goes with them
      // (lane 0198, review L), before the events are gone. The `read_at` prune
      // below stays as the catch-all for rows whose events an older build took.
      this.#dropTraitReadsOf(handle, "where ingested_at < ?", [eventCutoff])
      const events = Number(handle.run("delete from events where ingested_at < ?", eventCutoff).changes)
      // The refusal audit lives as long as the events it is about.
      handle.run("delete from event_refusals where at < ?", eventCutoff)
      handle.run("delete from unit_reads where read_at < ?", eventCutoff)
      // The gate's verdicts are about a day's text, and they go with it.
      handle.run("delete from trait_reads where read_at < ?", eventCutoff)
      handle.run("delete from agents_seen where last_seen < ?", new Date(now.getTime() - 90 * 86_400_000).toISOString())
      const expired = handle.all(
        "select id from records where kind = 'proposal' and status = 'proposed' and json_extract(fields, '$.expires') < ?",
        nowIso,
      )
      for (const { id } of expired) {
        this.#auditDelete(handle, SYSTEM_ACTOR, { id, kind: "proposal" }, "expire")
        this.#hardDelete(handle, id)
      }
      const receipts = this.#pruneReceipts(handle)
      // Spent grants are kept 300 s past their expiry (§4.8); a pruned grant
      // has already failed the verifier's time check. A reservation still
      // pending at that point is marked unrecorded, and both it and an
      // erasure's settled receipt are kept.
      this.#sweepPending(handle)
      const grants = Number(handle.run("delete from act_grants where exp < ? and act <> 'profile.erase'", Math.floor(now.getTime() / 1000) - 300).changes)
      // A preview's snapshot ends with its own short window too (0.11).
      handle.run("delete from act_previews where exp <= ?", Math.floor(now.getTime() / 1000))
      handle.run("delete from idempotent_writes where record_id not in (select id from records)")
      // Purge entries end with their window, salt and all.
      handle.run("delete from forget_purges where expires <= ?", nowIso)
      return { events, proposals: expired.length, receipts, grants }
    })
    if (handle.erasePending && handle.file) this.#truncateWal(handle)
    const left = Number(handle.get("select count(*) as n from events where retract_pending = 1")?.n ?? 0)
    const indexing = (handle.get("select value from meta where key = 'cite_edges'")?.value ?? "") !== "done"
    this.#settings.markWork(this.#spaceId, left > 0 || indexing)
    return done
  }

  // -------------------------------------------------------------------------
  // Keyed writes (docs/design/records-idempotency.md)

  /**
   * Run a write once per `(user, agent, idempotency_key)`. The key is looked up
   * before anything else, so a repeat replays its original result even when
   * the target has since changed or gone. Otherwise the write runs as without
   * a key, and `run(body, hook)` calls `hook(handle, result)` inside its own
   * transaction, which records the receipt in the same commit. A write that
   * fails records nothing.
   */
  #keyed(method, input, actor, run) {
    if (input.idempotency_key === undefined) {
      const { idempotency_age_ms: _age, ...plain } = input
      return run(plain, null)
    }
    const key = input.idempotency_key
    if (typeof key !== "string" || !IDEMPOTENCY_KEY.test(key)) throw invalid("invalid_request", "idempotency_key is invalid.", "Send 16 to 128 letters, digits, underscores or hyphens.")
    const age = input.idempotency_age_ms ?? 0
    if (!Number.isInteger(age) || age < 0 || age > MAX_ATTEMPT_AGE_MS) {
      throw invalid("invalid_request", "idempotency_age_ms must be the whole number of milliseconds since the write's first attempt.", "Send 0 on the first attempt, and the time since it on each retry.")
    }
    const a = normalizeActor(actor)
    const scope = [a.user, a.agent ?? "", key]
    const digest = writeDigest(method, input)
    const { idempotency_key: _key, idempotency_age_ms: _age, ...plain } = input
    const existing = this.#handleFor(this.#spaceId, false)
    if (existing) {
      const prior = this.#receipt(existing, scope)
      if (prior) return { ...this.#replay(existing, a, method, digest, prior), keyed: true }
    }
    this.#checkAttemptAge(age)
    const hook = (handle, result) => {
      const raced = this.#receipt(handle, scope)
      if (raced) throw new KeyRaced(raced)
      // Never evict a live receipt: at the cap, refuse the write (it rolls back).
      this.#makeRoomForReceipt(handle)
      handle.run(
        "insert into write_receipts (user_id, agent, key, method, digest, receipt, created) values (?, ?, ?, ?, ?, ?, ?)",
        ...scope,
        method,
        digest,
        JSON.stringify(receiptOf(result)),
        this.#nowIso(),
      )
      handle.receiptCount += 1
    }
    // `keyed: true` tells the client the key was honoured; an answer without
    // it from a keyed request means the service ignored the key.
    try {
      return { ...run(plain, hook), keyed: true }
    } catch (error) {
      if (!(error instanceof KeyRaced)) throw error
      return { ...this.#replay(this.#handleFor(this.#spaceId, false), a, method, digest, error.prior), keyed: true }
    }
  }

  #receipt(handle, [user, agent, key]) {
    return handle.get("select method, digest, receipt, created from write_receipts where user_id = ? and agent = ? and key = ?", user, agent, key) ?? null
  }

  /**
   * A key the ledger does not hold is applied only when its first attempt is
   * younger than the window. A receipt is kept for the window and a grace
   * period after it, and no live receipt is ever evicted, so within the
   * window a missing receipt means no earlier attempt was applied.
   */
  #checkAttemptAge(age) {
    if (age < this.#settings.receiptTtlMs) return
    throw conflict(
      "idempotency_expired",
      `This retry's first attempt is older than the records service can check (receipts are kept ${Math.round(this.#settings.receiptTtlMs / 3_600_000)} hours), so whether it was applied is unknown.`,
      "Read the current records, and write again only if the change is missing.",
    )
  }

  /** Delete receipts past the window and its grace period; returns how many. */
  #pruneReceipts(handle) {
    const cutoff = new Date(this.#settings.now().getTime() - this.#settings.receiptTtlMs - RECEIPT_GRACE_MS).toISOString()
    const removed = Number(handle.run("delete from write_receipts where created <= ?", cutoff).changes)
    if (handle.receiptCount !== null) handle.receiptCount = Math.max(0, handle.receiptCount - removed)
    return removed
  }

  /**
   * Make room for one more receipt without evicting a live one: at the cap,
   * prune expired receipts and count again; if the space is still full,
   * refuse the keyed write (it rolls back, so nothing is saved).
   */
  #makeRoomForReceipt(handle) {
    if (handle.receiptCount === null) handle.receiptCount = Number(handle.get("select count(*) as n from write_receipts").n)
    if (handle.receiptCount < this.#settings.receiptMax) return
    this.#pruneReceipts(handle)
    handle.receiptCount = Number(handle.get("select count(*) as n from write_receipts").n)
    if (handle.receiptCount < this.#settings.receiptMax) return
    throw new RecordsError(
      429,
      "idempotency_capacity",
      `Not saved: this space already holds the most recent-write receipts it keeps (${this.#settings.receiptMax}), and none has expired yet.`,
      "Nothing was written. Try again later; older receipts expire after their window.",
    )
  }

  /**
   * Record what a preview showed a person, for the press that will follow
   * (`acts.preview`).
   *
   * Jelly draws a confirmation from an action's preview and then presses with
   * **the same input it previewed**: it never merges the preview's answer into
   * the press. So the fields the press cannot know — a copy's page version and
   * the file it lands at, a space change's state digest — are remembered here,
   * keyed by the act and the digest of the input the person chose, for that
   * person, until they expire (`PREVIEW_TTL_SECONDS`). `applyGrant` spends one,
   * once, in the grant's own transaction and answers it back to the plugin, so
   * the operation runs on exactly the facts the person was shown.
   *
   * It changes nothing the person owns: a row in `act_previews`, which is
   * transient (`TRANSIENT_TABLES`) and refused for an act that is not
   * `stateBound` — no other act has anything to remember.
   *
   * @param {{act: string, input?: unknown, binding?: unknown}} input
   * @param {object} actor the caller the gateway authenticated
   */
  async recordPreview(input, actor) {
    const a = normalizeActor(actor)
    const identity = a.identity ?? {}
    // A preview is the person's own, made through their host: the caller
    // `acts.apply` accepts, less the grant. An agent credential, or one that
    // names no Jelly ID account, keeps no snapshot — an agent never presses,
    // and a snapshot is what a press will read. A caller that names no host is
    // refused for the same reason a hostless press is: only a host's own
    // credential makes one, and the press is held to that host.
    if (identity.principal !== "person" || !identity.subject || !identity.issuer) throw grantRefused("grant_member")
    if (typeof identity.host !== "string" || !identity.host) throw grantRefused("grant_host")
    const body = requireObject(input, "acts.preview")
    const extra = Object.keys(body).filter((key) => !["act", "input", "binding"].includes(key))
    if (extra.length > 0) {
      throw invalid("invalid_request", `acts.preview does not accept ${extra.map((key) => JSON.stringify(key)).join(", ")}.`, "Send exactly {act, input, binding}.")
    }
    const declared = typeof body.act === "string" ? this.#settings.acts.get(body.act) : undefined
    if (!declared) throw grantRefused("grant_action")
    if (declared.stateBound !== true) {
      throw invalid("invalid_request", `A preview of ${body.act} has nothing to remember: neither its input nor its change is bound to state the person saw.`, "Record a preview only for an act whose declaration is `stateBound`.")
    }
    const binding = requireObject(body.binding ?? {}, "acts.preview")
    const encoded = JSON.stringify(binding)
    if (Buffer.byteLength(encoded) > MAX_PREVIEW_BINDING_BYTES) {
      throw invalid("invalid_request", `A preview's snapshot is at most ${MAX_PREVIEW_BINDING_BYTES} bytes.`, "Record only the fields the press needs.")
    }
    const digest = previewDigest(body.input ?? {})
    const now = Math.floor(this.#settings.now().getTime() / 1000)
    const writer = this.#writer(a)
    writer.run("delete from act_previews where exp <= ?", now)
    // A second preview of the same act, input, person and host is a person
    // looking again, and it replaces the row — but never silently: the
    // superseded binding is kept, the revision counted, and the answer says it
    // replaced one. Nothing else can replace it: an agent credential is
    // refused above, and another host's preview is its own row.
    const live = writer.get("select binding, previous, revisions from act_previews where act = ? and input_digest = ? and user_id = ? and host = ? and exp > ?", body.act, digest, a.user, identity.host, now)
    const previous = live ? [...(parse(live.previous, []) ?? []), parse(live.binding, null)].filter((entry) => entry !== null).slice(-MAX_PREVIEW_REVISIONS) : []
    const revisions = live ? Number(live.revisions) + 1 : 1
    writer.run(
      `insert into act_previews (act, input_digest, user_id, host, binding, previous, revisions, created_at, exp) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict(act, input_digest, user_id, host) do update set binding = excluded.binding, previous = excluded.previous, revisions = excluded.revisions, created_at = excluded.created_at, exp = excluded.exp`,
      body.act,
      digest,
      a.user,
      identity.host,
      encoded,
      previous.length ? JSON.stringify(previous) : null,
      revisions,
      this.#nowIso(),
      now + PREVIEW_TTL_SECONDS,
    )
    return {
      recorded: true,
      act: body.act,
      host: identity.host,
      replaced: Boolean(live),
      revisions,
      expires: new Date((now + PREVIEW_TTL_SECONDS) * 1000).toISOString(),
    }
  }

  /**
   * The snapshot a press spends: the one its person's own preview left for this
   * act and this input, removed here so a second press of the same input finds
   * none and asks for a fresh preview. Runs inside the grant's transaction, so
   * a refused grant spends nothing.
   *
   * @param {Handle} handle
   * @param {string} act
   * @param {unknown} input
   * @param {string} user
   * @returns {Record<string, unknown> | null}
   */
  #takePreview(handle, act, input, user, host) {
    const digest = previewDigest(input)
    const now = Math.floor(this.#settings.now().getTime() / 1000)
    const row = handle.get("select binding from act_previews where act = ? and input_digest = ? and user_id = ? and host = ? and exp > ?", act, digest, user, host ?? "", now)
    if (!row) return null
    handle.run("delete from act_previews where act = ? and input_digest = ? and user_id = ? and host = ?", act, digest, user, host ?? "")
    return parse(row.binding, null)
  }

  /**
   * Apply one act a person chose in their host's UI: the grant door
   * (docs/design/adr-verified-caller-grants.md §4.6 and §4.8, `acts.apply`).
   *
   * The grant is verified here again, whatever the plugin checked: this is the
   * boundary. Then the member is bound to the caller's own identity, and the
   * act and its ledger row are written in one transaction, so a replay and a
   * refused act leave nothing behind. An act this build does not apply, or the
   * operator has not enabled, is `grant_action` and changes nothing.
   *
   * It runs dark: no act is enabled by default (`RECORDS_ACTIONS_ENABLED`), so
   * every call is refused before any write whatever this build registers
   * (`acts.js`: #58 A1, A10, A12, A13 and A15). The body is exactly
   * `{act, input, grant}`.
   *
   * @param {{act: string, input?: unknown, grant: string}} input
   * @param {object} actor the caller the gateway authenticated
   */
  async applyGrant(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "acts.apply")
    // The body is exactly {act, input, grant}: no caller-supplied result, item
    // or identity may ride along and be mistaken for the act's own.
    const extra = Object.keys(body).filter((key) => key !== "act" && key !== "input" && key !== "grant")
    if (extra.length > 0) {
      throw invalid("invalid_request", `acts.apply does not accept ${extra.map((key) => JSON.stringify(key)).join(", ")}.`, "Send exactly {act, input, grant}.")
    }
    const enabled = {}
    for (const [name, act] of this.#settings.acts) {
      if (this.#settings.actsEnabled.has(name)) enabled[name] = { minClass: act.minClass, inputKeys: act.inputKeys ?? {} }
    }
    const verdict = verifyActionGrant({
      grant: body.grant,
      input: body.input,
      act: body.act,
      allowed: enabled,
      keys: this.#settings.actKeys?.check?.() ?? { entries: [] },
      audience: this.#settings.actAudience,
      now: Math.floor(this.#settings.now().getTime() / 1000),
    })
    if (!verdict.ok) throw grantRefused(verdict.code)
    // §4.5: the grant acts only for the member it names, through that member's
    // own credential from the issuer the key entry binds. Never an agent's.
    //
    // Jelly master names the person twice: `mbr` is the host's own member
    // account (ADR 0025 §7), and `jid` is the Jelly ID account their resource
    // token names as `sub`. The caller's identity subject is the Jelly ID one,
    // so `jid` alone binds a grant to its person. `mbr` identifies nobody here:
    // a grant without `jid` names no member, and is refused rather than bound to
    // a host-local account the gateway never verified.
    const identity = a.identity ?? {}
    const jid = verdict.claims.jid
    if (typeof jid !== "string" || !jid) {
      throw new RecordsError(
        403,
        "grant_member",
        "The grant names no Jelly ID account, so this service cannot tell which person chose it.",
        "Sign in to Jelly ID on the host that signed this grant, then press again.",
      )
    }
    if (identity.principal !== "person" || !identity.subject || identity.subject !== jid || identity.issuer !== verdict.entry.mbrIss) {
      throw grantRefused("grant_member")
    }
    const act = this.#settings.acts.get(body.act)
    // §4.5 and P2 (docs/design/p2-control.md §2): the grant is the host's own,
    // and is spent only for a request that came through that host. A grant that
    // verified against another host's key is refused before the ledger row.
    //
    // A grant comes from a Jelly press, and a Jelly press always names its host.
    // A caller that names none therefore has no legitimate source for one, so it
    // is refused here, before the grant is spent: nothing is burnt, and no
    // reservation answers a proof nothing can spend. The agent door (`mem_*`
    // with asks) carries no grant at all and is unaffected.
    if (!identity.host) throw grantRefused("grant_host")
    if (identity.host !== verdict.claims.iss) throw grantRefused("grant_host")
    const handle = this.#existing(a)
    if (!handle) throw conflict("space_gone", "This space no longer exists; nothing was applied.", "Nothing to do: the space was purged.")
    const claims = verdict.claims
    // Jelly's answer 7: where the act declares `confirm: "always"`, the grant
    // must carry `cfm: "always"` — the host drew the confirmation before it
    // signed. A missing or weaker confirmation changes nothing.
    if (act.confirm === "always" && claims.cfm !== "always") throw grantRefused("grant_confirm")
    // §4.7 step 12: one act, one store, before the transaction opens. A refused
    // scope changes nothing and spends nothing.
    this.#actScope(act, body.input, a, handle)
    const answer = handle.tx(() => {
      this.#pruneGrants(handle)
      const prior = handle.get("select user_id, receipt from act_grants where host = ? and jti = ?", claims.iss, claims.jti)
      if (prior) {
        // The first use stands. Its receipt answers the same person, so a lost
        // response is not a lost act; anyone else learns only that it was used.
        throw grantRefused("grant_replayed", prior.user_id === a.user ? { receipt: parse(prior.receipt, null) } : undefined)
      }
      const nowIso = this.#nowIso()
      // What the person was shown, for the acts whose press cannot name it
      // (0.11): spent here, once, in the same transaction as the grant, so a
      // refused press spends nothing and a second press finds nothing. Only the
      // host the preview was made through finds it — the grant above is bound
      // to that host too — and the plugin puts these fields on the operation's
      // input, exactly as if the page had sent them back.
      const preview = act.stateBound === true ? this.#takePreview(handle, claims.act, body.input, a.user, identity.host) : null
      // An act a press may take only from its preview cannot run on no
      // snapshot: the person was shown facts a press never sends back.
      if (act.previewRequired === true && !preview) throw grantRefused("grant_preview")
      const receipt = act.run({ store: this, handle, actor: a, input: body.input, claims, entry: verdict.entry, now: nowIso, preview })
      // The row is inserted below, so an act that has not finished must not get
      // one: a promise here means the work would run after this transaction
      // commits. Refuse, and let the rollback undo whatever it wrote.
      if (receipt && (typeof receipt === "object" || typeof receipt === "function") && typeof receipt.then === "function") {
        try {
          receipt.then?.(undefined, () => {})
        } catch {
          // a thenable that will not take handlers is still refused
        }
        throw new RecordsError(500, "internal", `The act ${claims.act} answered a promise: an act must finish inside its transaction.`, "Report it to the service's maintainer; nothing was applied.")
      }
      const item = receipt?.record?.id ?? receipt?.recordId ?? receipt?.id ?? null
      handle.run(
        "insert into act_grants (host, jti, act, input_digest, user_id, device, class, item, exp, spent_at, receipt) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        claims.iss,
        claims.jti,
        claims.act,
        claims.in,
        a.user,
        claims.dev,
        claims.cls,
        typeof item === "string" && item ? item : null,
        claims.exp,
        nowIso,
        JSON.stringify(receipt ?? null),
      )
      return { act: claims.act, receipt: receipt ?? null, spent: { host: claims.iss, jti: claims.jti, at: nowIso }, ...(preview ? { preview } : {}) }
    })
    // A control-plane act's change lands at the control plane, which does not
    // hold the host's grant; so the reservation answers a short-lived proof of
    // what this transaction spent — the act, its input's digest, this person,
    // this grant — that the gateway carries and control verifies and spends in
    // its own ledger (docs/design/p2-control.md §2). It authorises nothing on
    // its own: the grant is already spent, and the act is already named.
    const reservation = act.control === true ? this.#reservationOf({ key: this.#settings.p2Key, act: claims.act, digest: claims.in, user: a.user, host: claims.iss, jti: claims.jti }) : undefined
    // After the transaction, never inside it: a forget's text is truncated out
    // of the WAL only once the change committed, so a rollback leaves the file
    // as it was.
    const withReservation = reservation === undefined ? answer : { ...answer, reservation }
    if (body.act === "memory.forget") return { ...withReservation, erase: this.#eraseFile() }
    return withReservation
  }

  /**
   * The proof a control-plane act's reservation answers, or undefined when no
   * key is configured (the path is then off: control refuses every request that
   * carries one, and the act stays unreachable from a host's page).
   */
  #reservationOf({ key, act, digest, user, host, jti }) {
    if (!key) return undefined
    return issueReservation({ key, act, in: digest, user, host, jti, now: Math.floor(this.#settings.now().getTime() / 1000) })
  }

  // -------------------------------------------------------------------------
  // The acts a person's click applies (§4.7). Each runs inside the grant's
  // transaction, writes through `handle`, and answers the receipt the person
  // sees. They are synchronous by contract: the ledger row commits with them.

  /**
   * The caller an act writes as (§4.8): the member the grant names, stamped as
   * acting through a grant, so history records `via: "grant"` and a proposal's
   * `decided_via` is "grant", never a tool's "bearer".
   */
  #actActor(a, claims) {
    return { ...a, grant: { host: claims.iss, device: claims.dev, class: claims.cls, jti: claims.jti } }
  }

  /**
   * §4.7 step 12: one act, one store. A `space` act names this store (its
   * `store` path in the input, `space` by default), or — for an act that names
   * no store at all, such as a new space or a handover — is spent in the
   * caller's own personal space, as its owner, with no page grant. A `personal`
   * act runs only in the caller's own personal space. Anything else is
   * `grant_scope`, before any write.
   */
  #actScope(act, input, a, handle) {
    const body = isPlainObject(input) ? input : {}
    const named = this.#namedSpace(act, body)
    if (act.scope === "space") {
      if (named !== undefined && (typeof named !== "string" || !named || named !== this.#spaceId)) throw grantRefused("grant_scope")
      if (named === undefined) this.#personalStore(a, handle)
      return
    }
    // A personal act may still name its store, so the grant's input says which
    // space it is for: it must be this one.
    if (named !== undefined && (typeof named !== "string" || !named || named !== this.#spaceId)) throw grantRefused("grant_scope")
    this.#personalStore(a, handle)
  }

  /**
   * The store an act's input names, or `undefined`: the dot path its declaration
   * gives (`store`), with the input's own `space` as the fallback. An act whose
   * `space` names something to act on rather than a store (`space.join`)
   * declares `store: null` and names none.
   */
  #namedSpace(act, body) {
    if (act.store === null) return undefined
    const path = act.store ?? "space"
    let value = body
    for (const key of path.split(".")) {
      value = isPlainObject(value) ? value[key] : undefined
      if (value === undefined) break
    }
    if (value === undefined && path !== "space") value = body.space
    return value
  }

  /** The caller's own personal space, as its owner, with no page grant (§4.7 step 12). */
  #personalStore(a, handle) {
    const kind = handle?.meta?.space_kind ?? a.spaceKind
    if (kind !== "personal") throw grantRefused("grant_scope")
    if (a.role !== "owner") throw grantRefused("grant_scope")
    if (Array.isArray(a.grants) && a.grants.length > 0) throw grantRefused("grant_scope")
    if (handle?.meta?.owner_user && handle.meta.owner_user !== a.user) throw grantRefused("grant_scope")
  }

  /** A commitment's state, its words and its due date: A13's five controls. */
  applyActCommitment({ op, input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, `commitment.${op}`)
    const id = requireId(body.id)
    const current = this.#load(handle, id)
    if (!current || !visibleRecord(a, current) || current.kind !== "commitment") {
      throw notFound(`No commitment ${id} in this space.`, "List them with commitments.list, then choose one.")
    }
    if (!canWrite(a, current.path)) throw actRefused("not_owner")
    // Jelly's answer 4: the grant names the version the person saw, so a stale
    // press answers with the item's current state for the host to show.
    if (body.revision !== undefined && body.revision !== current.version) {
      throw actRefused("revision_conflict", { id, status: current.status, version: current.version, state: current.fields?.state ?? "open" })
    }
    // A control must name the version it changes: without it the guard cannot
    // tell a stale press from a fresh one, and a press from an old list could
    // overwrite an edit the person did not see. The list always carries the
    // record's own revision, so refusing a press with none costs nothing.
    if (body.revision === undefined) throw invalid("invalid_request", "A commitment act names the version it changes.", "Send revision: the version commitments.list returned.")
    const state = typeof current.fields?.state === "string" ? current.fields.state : "open"
    const stateNow = () => ({ id, status: current.status, version: current.version, state })
    const nowIso = this.#nowIso()
    let fields = { ...current.fields }
    let title = current.title
    if (op === "done" || op === "cancel") {
      if (state !== "open") throw actRefused("not_pending", stateNow())
      fields = { ...fields, state: op === "done" ? "done" : "cancelled", closed_at: nowIso }
    } else if (op === "reopen") {
      if (state === "open") throw actRefused("not_pending", stateNow())
      fields = { ...fields, state: "open" }
      delete fields.closed_at
    } else if (op === "snooze") {
      if (state !== "open") throw actRefused("not_pending", stateNow())
      fields = { ...fields, due: actDue(body.due) }
    } else if (op === "edit") {
      if (typeof body.what !== "string" || !body.what.trim() || body.what.length > 300) {
        throw invalid("invalid_record", "An edit needs what will be done, up to 300 characters.", "Send the commitment's new words.")
      }
      title = body.what.trim()
      fields = { ...fields, what: title }
      if (body.due !== undefined) {
        if (body.due === "") delete fields.due
        else fields.due = actDue(body.due)
      }
    } else {
      throw invalid("invalid_action", `"${op}" is not a commitment control.`, "Send done, cancel, reopen, snooze or edit.")
    }
    const saved = this.#save(handle, current, { ...current, title, fields }, this.#change(a, op === "edit" ? "update" : op))
    return { id, state: saved.fields.state ?? "open", version: saved.version }
  }

  /**
   * A13's add: one commitment in the person's own space, with the words as the
   * person wrote them, `stated_by: "person"` and state `open`. A duplicate of an
   * open commitment is answered unchanged rather than written twice, as the
   * console answers it.
   */
  applyActCommitmentCreate({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "commitment.create")
    const what = typeof body.what === "string" ? body.what.trim().replace(/\s+/g, " ") : ""
    if (!what || what.length > 300) throw invalid("invalid_record", "A commitment needs what will be done, up to 300 characters.", "Send what: \"Send the Q4 numbers to Ama\".")
    refuseUnstorable([what], "commitment")
    const due = body.due === undefined || body.due === "" ? undefined : actDue(body.due)
    const open = handle.all("select id from records where kind = 'commitment' order by created").map((row) => this.#load(handle, row.id)).filter((record) => record && visibleRecord(a, record) && record.status === "current" && (record.fields?.state ?? "open") === "open")
    const same = open.find((record) => String(record.fields?.what ?? record.title ?? "").trim().toLowerCase() === what.toLowerCase())
    if (same) return { id: same.id, state: "open", version: same.version, unchanged: true }
    const fresh = newRecord(
      { kind: "commitment", type: "commitment", title: what, body: [what, ...(due ? [`Due: ${due}`] : [])].join("\n"), stated_by: "person", fields: { what, state: "open", ...(due ? { due } : {}) } },
      a,
      this.#nowIso(),
      this.#settings.proposalTtlDays,
    )
    // The person's own words: this only runs inside their host-signed grant
    // (Jelly's RPC fence refuses `act.*` to anything but the host's call), so
    // the record says `person` and never `agent`.
    const done = this.#create(handle, a, { ...fresh, stated_by: "person" }, this.#change(a, "create"))
    return { id: done.record.id, state: "open", version: done.record.version }
  }

  /**
   * A13's delete: one commitment, at the version the person saw, removed for
   * good (`purge`, so the text is not kept). It is `local` at the door: it
   * cannot be put back.
   */
  applyActCommitmentDelete({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "commitment.delete")
    const id = requireId(body.id)
    const current = this.#load(handle, id)
    if (!current || !visibleRecord(a, current) || current.kind !== "commitment") {
      throw notFound(`No commitment ${id} in this space.`, "List them with commitments.list, then choose one.")
    }
    if (!canWrite(a, current.path)) throw actRefused("not_owner")
    if (!Number.isSafeInteger(body.revision)) throw invalid("invalid_request", "A commitment act names the version it changes.", "Send revision: the version commitments.list returned.")
    if (body.revision !== current.version) {
      throw actRefused("revision_conflict", { id, status: current.status, version: current.version, state: current.fields?.state ?? "open" })
    }
    this.#delete({ ids: [id], purge: true }, a, null)
    return { id, state: "deleted", version: current.version, count: 1 }
  }

  /**
   * #58 A14, jelly's "Save to Memory" on a Messages line: one line of a
   * conversation kept as a memory in the space the press names — the person's
   * own by default — cited to the line it came from (`source.conversation`,
   * `source.line`, `source.author` and `source.at`, which every read that names
   * a record's source then shows).
   *
   * The person pressed, so the words are theirs (`stated_by: "person"`) only
   * when the line's author is them; a line someone else wrote is `external` and
   * never becomes their statement. The kind is `fact`, so an instruction-shaped
   * line is never kept as a preference or a procedure. A secret is refused, and
   * so is text a person forgot. The same line saved twice answers the memory
   * that already holds it, rather than keeping a second copy.
   */
  applyActSaveLine({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "memory.saveLine")
    const text = typeof body.text === "string" ? body.text.trim() : ""
    if (!text) throw invalid("invalid_request", "Saving a line needs its words.", "Send text with the line to keep.")
    if (text.length > LINE_CHARS) {
      throw tooLarge(`The line is ${text.length} characters; a saved line is at most ${LINE_CHARS}.`, "Keep the sentence or two that matter, or put the whole exchange on a page.")
    }
    const from = requireLineSource(body.from)
    // A line is a write to the space it lands in, and nothing else: a reader of
    // a shared space is refused before anything is written.
    requireRole(a, "editor", "Saving a line to this space needs the editor role")
    // The words and the citation both: an email address in `from.author` is
    // personal data exactly as it is in the line, and the same check refuses it
    // (0.12.5 review, L).
    refuseUnstorable([text, ...Object.values(from)], "remember")
    // One line, one memory: a repeat (or a retry after a lost answer) answers
    // the memory the first press made, and keeps no second copy.
    const prior = handle.get(
      "select id, version from records where kind = 'memory' and json_extract(source, '$.conversation') = ? and json_extract(source, '$.line') = ? order by version desc limit 1",
      from.conversation,
      from.line,
    )
    if (prior) {
      const found = this.#load(handle, prior.id)
      if (found && visibleRecord(a, found)) return { id: found.id, state: found.status ?? "current", version: found.version }
    }
    // A forget keeps keyed fingerprints of the words it removed, and verbatim
    // tombstones beside them; a line that copies either is not written again.
    if (this.#textTombstoned(handle, [text]) || this.#forgottenMatcher(handle).matches(text).length > 0) {
      throw conflict("forgotten", "Not written: a person forgot this line.", "Do not save it again.")
    }
    const mine = typeof from.author === "string" && (from.author === a.user || /^(?:you|me|self)$/i.test(from.author.trim()))
    const fresh = newRecord(
      {
        kind: "memory",
        type: "fact",
        title: titleFromBody(text, 300),
        body: text,
        fields: {},
        source: from,
      },
      a,
      this.#nowIso(),
      this.#settings.proposalTtlDays,
    )
    // The person's own words, for the reason `commitment.create` gives: an act
    // only runs inside their host-signed grant. A line by anyone else stays
    // `external`, which a read labels as someone else's statement.
    const done = this.#create(handle, a, { ...fresh, stated_by: mine ? "person" : "external" }, this.#change(a, "create"))
    return { id: done.record.id, state: done.record.status ?? "current", version: done.record.version }
  }

  /**
   * A10 and A15: one decision on a proposal — a contended record's keep, edit or
   * forget (a proposal of any other type), or the author's accept, private or
   * decline of a held team write. `revision` is the proposal's version the
   * person saw (`review.list`), so a stale page cannot decide new words.
   */
  applyActReview({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "review.decide")
    const id = requireId(body.id)
    const op = body.op
    const proposal = this.#load(handle, id)
    if (!proposal || proposal.kind !== "proposal" || !visibleRecord(a, proposal)) {
      throw notFound(`No proposal ${id} in this space.`, "List what waits with review.list, then choose one.")
    }
    // An item already decided is not waiting for this: say what it is now.
    if (proposal.status !== "proposed" && proposal.status !== "accepting") {
      throw actRefused("not_pending", { id, status: proposal.status, version: proposal.version })
    }
    if (!Number.isSafeInteger(body.revision)) throw invalid("invalid_request", "A decision names the version the person saw.", "Send revision: the version review.list returned.")
    if (proposal.version !== body.revision) {
      throw actRefused("revision_conflict", { id, status: proposal.status, version: proposal.version })
    }
    if (proposal.type === "team_write") {
      if (!["accept", "private", "decline"].includes(op)) {
        throw invalid("invalid_action", `A held write takes accept, private or decline, not "${op}".`, "Send one decision.")
      }
      const decided = this.#decideTeamWrite(handle, a, { id, decision: op, base_version: proposal.version }, id)
      return { id, state: decided.proposal.status, version: decided.proposal.version }
    }
    const decision = op === "reject"
      ? { id, decision: "reject", ...(typeof body.text === "string" && body.text.trim() ? { reason: body.text } : {}) }
      : op === "edit"
        ? { id, decision: "edit", payload: editedPayload(proposal, body.text) }
        : op === "accept" ? { id, decision: "accept" } : null
    if (!decision) {
      throw invalid("invalid_action", `A proposed record takes accept, edit or reject, not "${op}".`, "Send one decision.")
    }
    const decided = this.#decideProposal(decision, a, handle)
    return {
      id,
      state: decided.proposal.status,
      version: decided.proposal.version,
      ...(decided.applied?.id ? { applied: decided.applied.id } : {}),
    }
  }

  /**
   * Jelly's answer 5: a memory the person confirms or corrects, at the version
   * they saw. `space` names the one store; records' own rules decide the role.
   */
  applyActMemoryRevise({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "memory.revise")
    const action = body.action === "confirm" || body.action === "correct" || body.action === "add" ? body.action : null
    if (!action) throw invalid("invalid_action", "a memory takes confirm, correct or add.", "Send one.")
    // An added memory has no version yet: it is written at this store's next
    // version, with the person as its author.
    if (action === "add") {
      const content = typeof body.content === "string" ? body.content.trim() : ""
      if (!content) throw invalid("invalid_request", "A new memory needs its words.", "Send content with the memory to keep.")
      refuseUnstorable([content], "remember")
      const title = content.split("\n").find((line) => line.trim())?.trim().slice(0, 160) || content.slice(0, 160)
      const fresh = newRecord({ kind: "memory", type: "fact", title, body: content, fields: {} }, a, this.#nowIso(), this.#settings.proposalTtlDays)
      // The person's own words, for the reason `commitment.create` gives: an
      // act only runs inside their host-signed grant.
      const done = this.#create(handle, a, { ...fresh, stated_by: "person" }, this.#change(a, "create"))
      return { id: done.record.id, state: done.record.status ?? "current", version: done.record.version }
    }
    const id = requireId(body.id)
    const current = this.#load(handle, id)
    if (!current || !visibleRecord(a, current) || current.kind !== "memory") {
      throw notFound(`No memory ${id} in this space.`, "Check the id with memories.recent.")
    }
    if (!Number.isSafeInteger(body.revision)) throw invalid("invalid_request", "A memory act names the version the person saw.", "Send revision: the version memories.recent returned.")
    if (body.revision !== current.version) {
      throw actRefused("revision_conflict", { id, status: current.status, version: current.version })
    }
    if (action === "correct" && (typeof body.content !== "string" || !body.content.trim())) {
      throw invalid("invalid_request", "correct needs the corrected text.", "Send content with the words to keep.")
    }
    const done = this.#revise({ id, action, ...(action === "correct" ? { body: body.content } : {}) }, a, null)
    return { id, state: done.record?.status ?? current.status, version: done.record?.version ?? current.version + 1, applied: done.record?.id ?? id }
  }

  /**
   * Jelly's answer 5: forgetting a memory is an owner device's, always confirmed.
   * It is the person's own private memory here: a team page's forget stays in
   * Memory's console.
   */
  applyActMemoryForget({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "memory.forget")
    const id = requireId(body.id)
    const current = this.#load(handle, id)
    if (!current || !visibleRecord(a, current)) {
      throw notFound(`No record ${id} in this space.`, "Check the id with memories.recent.")
    }
    if (!Number.isSafeInteger(body.revision)) throw invalid("invalid_request", "A forget names the version the person saw.", "Send revision: the version memories.recent returned.")
    if (body.revision !== current.version) {
      throw actRefused("revision_conflict", { id, status: current.status, version: current.version })
    }
    if (current.kind === "page") throw actRefused("needs_approval")
    const outcome = this.#reviseBatch({ ids: [id], action: "forget" }, a, null)
    const row = outcome.results?.[0]
    if (!row?.ok) throw actRefused("not_pending", { id, status: current.status, version: current.version })
    // The WAL is truncated after the act's transaction commits (applyGrant does
    // it, as `revise` does), so the erased text does not linger and a rollback
    // never truncates.
    return { id, state: row.deleted ? "forgotten" : "unchanged", version: current.version }
  }

  /**
   * The Inbox's decision (Jelly's answers 2 and 6): `itemId` is Memory's own
   * key, `proposal:rec_…`, and `revision` is the proposal's version as
   * `inbox.list` returned it. It routes to the same review decision a
   * `review.decide` makes, and a stale or already-decided item answers with the
   * item's current state.
   */
  applyActInboxDecide({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "inbox.decide")
    const key = String(body.itemId ?? "")
    const match = /^proposal:(rec_[0-9A-HJKMNP-TV-Z]{26})$/.exec(key)
    if (!match) throw notFound(`No item ${JSON.stringify(key)} in your Inbox.`, "Send itemId as inbox.list returns it: proposal:rec_…")
    const id = match[1]
    const proposal = this.#load(handle, id)
    if (!proposal || proposal.kind !== "proposal" || !visibleRecord(a, proposal)) {
      throw notFound(`No item ${key} in your Inbox.`, "List what waits with inbox.list.")
    }
    const decision = body.decision
    if (!["accept", "private", "decline"].includes(decision)) {
      throw invalid("invalid_action", `an Inbox item takes accept, private or decline, not ${JSON.stringify(decision)}.`, "Send one decision.")
    }
    // An item already decided is not waiting for this: say what it is now.
    if (proposal.status !== "proposed" && proposal.status !== "accepting") {
      throw actRefused("not_pending", { id, status: proposal.status, version: proposal.version })
    }
    if (!Number.isSafeInteger(body.revision)) throw invalid("invalid_request", "A decision names the version the person saw.", "Send revision: the version review.list returned.")
    if (proposal.version !== body.revision) {
      throw actRefused("revision_conflict", { id, status: proposal.status, version: proposal.version })
    }
    if (proposal.type === "team_write") {
      const decided = this.#decideTeamWrite(handle, a, { id, decision, base_version: proposal.version }, id)
      return { id, state: decided.proposal.status, version: decided.proposal.version }
    }
    // A routine proposal has no private keep; decline is its reject.
    if (decision === "private") {
      throw invalid("invalid_action", "a routine proposal is accepted or declined, not kept private.", "Send accept or decline.")
    }
    const decided = this.#decideProposal({ id, decision: decision === "accept" ? "accept" : "reject" }, a, handle)
    return { id, state: decided.proposal.status, version: decided.proposal.version, ...(decided.applied?.id ? { applied: decided.applied.id } : {}) }
  }

  /**
   * A15: a held team write edited in place, or turned private. The proposal
   * stays the author's, in their own personal space; nothing reaches the shared
   * space until it is accepted there (J-HELD).
   */
  applyActHeldWrite({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "write.decide")
    const id = requireId(body.id)
    const proposal = this.#load(handle, id)
    if (!proposal || proposal.kind !== "proposal" || proposal.type !== "team_write" || !visibleRecord(a, proposal)) {
      throw notFound(`No held write ${id} in this space.`, "Held writes wait in review.list, in your own space.")
    }
    if (proposal.author.user !== a.user) throw actRefused("not_owner")
    if (!Number.isSafeInteger(body.revision)) throw invalid("invalid_request", "A held write's decision names the version the person saw.", "Send revision: the version review.list returned.")
    if (proposal.version !== body.revision) {
      throw actRefused("revision_conflict", { id, status: proposal.status, version: proposal.version })
    }
    if (body.op === "private") {
      const decided = this.#decideTeamWrite(handle, a, { id, decision: "private", base_version: proposal.version }, id)
      return { id, state: decided.proposal.status, space: proposal.fields?.space_name ?? null }
    }
    if (body.op !== "edit") {
      throw invalid("invalid_action", `A held write takes edit or private, not "${body.op}".`, "Send one.")
    }
    return this.#editHeldWrite(handle, a, proposal, body.text)
  }

  /**
   * A held team write's first record, corrected by its author while it still
   * waits. One copy of the change: the action's `write.decide` op `edit`
   * (above) and the console's `review.edit` both reach it, so the two doors
   * write the same words and keep the same journal entry.
   */
  #editHeldWrite(handle, a, proposal, text) {
    const id = proposal.id
    // Its words are the author's only while it still waits: once it is
    // `accepting`, the shared cell is applying them, and an edit here would
    // change a copy nobody reads.
    if (proposal.status !== "proposed") throw actRefused("not_pending", { id, status: proposal.status, version: proposal.version })
    if (typeof text !== "string" || !text.trim()) {
      throw invalid("invalid_record", "An edit needs the words the held write should hold.", "Send the text the person saw, corrected.")
    }
    const payload = parse(proposal.body, null)
    const records = Array.isArray(payload?.records) ? payload.records : []
    if (records.length === 0) throw actRefused("not_pending")
    const nextBody = JSON.stringify({ ...payload, records: [{ ...records[0], body: text }, ...records.slice(1)] })
    const saved = this.#save(handle, proposal, {
      ...proposal,
      body: nextBody,
      fields: { ...proposal.fields, preview: heldPreview(text) },
    }, this.#change(a, "edit"))
    return { id, state: saved.status, version: saved.version }
  }

  /**
   * #78: a held team write's one decision, `held.decide` — accept, edit or
   * drop — bound to the version its preview showed. It is the same change the
   * three existing doors make (`review.decide` accept/decline, `write.decide`
   * edit), reached by one name, and `accept` answers `accepting` for the plugin
   * to complete the shared write the one way held writes are completed.
   */
  applyActHeldDecide({ input, actor, handle, claims, preview }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "held.decide")
    const id = requireId(body.id)
    const op = body.op
    if (!["accept", "edit", "drop"].includes(op)) {
      throw invalid("invalid_action", `a held write takes accept, edit or drop, not ${JSON.stringify(op)}.`, "Send one decision.")
    }
    const proposal = this.#load(handle, id)
    if (!proposal || proposal.kind !== "proposal" || proposal.type !== "team_write" || !visibleRecord(a, proposal)) {
      throw notFound(`No held write ${id} in this space.`, "Held writes wait in review.list, in your own space.")
    }
    if (proposal.author.user !== a.user) throw actRefused("not_owner")
    if (proposal.status !== "proposed" && proposal.status !== "accepting") {
      throw actRefused("not_pending", { id, status: proposal.status, version: proposal.version })
    }
    // The version the preview showed, or one the caller named itself: a press
    // never sends the preview's fields, so the snapshot is where it comes from.
    const revision = Number.isSafeInteger(body.revision) ? body.revision : Number.isSafeInteger(preview?.revision) ? preview.revision : null
    if (revision === null) {
      throw invalid("invalid_request", "A held write's decision names the version the person saw.", "Read its preview again, then press the same input.")
    }
    if (proposal.version !== revision) {
      throw actRefused("revision_conflict", { id, status: proposal.status, version: proposal.version })
    }
    // F2: the words that land are exactly the words the preview showed. Jelly's
    // confirmation is cut past its preview cap, so a longer text would land
    // with its end unseen: refuse it here, before anything is written.
    const problem = heldEditsProblem(body.edits)
    if (problem) {
      throw invalid(
        "invalid_record",
        `the corrected words are ${problem.length} characters of preview text, and a confirmation shows at most ${problem.limit}, so their end would land unseen.`,
        `Shorten the words to ${HELD_EDITS_MAX} characters or fewer, then edit or accept again.`,
      )
    }
    if (op === "edit") {
      return this.#editHeldWrite(handle, a, proposal, body.edits)
    }
    if (op === "accept") {
      // Accept the words the person chose: an edited accept corrects the held
      // batch first, then accepts it at the version that edit made.
      const current = typeof body.edits === "string" && body.edits.trim() ? (this.#editHeldWrite(handle, a, proposal, body.edits), this.#load(handle, id)) : proposal
      const decided = this.#decideTeamWrite(handle, a, { id, decision: "accept", base_version: current.version }, id)
      return { id, state: decided.proposal.status, version: decided.proposal.version }
    }
    const decided = this.#decideTeamWrite(handle, a, { id, decision: "decline", base_version: proposal.version }, id)
    return { id, state: decided.proposal.status, version: decided.proposal.version }
  }

  /**
   * #77: "Not now" hides one suggestion from `mem.suggestions` without deciding
   * it: the proposal still waits in review, and nothing is saved or shared.
   * `forever` also turns its kind off in this space (a `suggestion_off:<kind>`
   * row in the space's meta, name only), so later suggestions of that kind are
   * not raised either.
   */
  applyActSuggestionDismiss({ input, actor, handle, claims, preview }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "suggestion.dismiss")
    const id = requireId(body.id)
    const proposal = this.#load(handle, id)
    if (!proposal || proposal.kind !== "proposal" || !visibleRecord(a, proposal)) {
      throw notFound(`No suggestion ${id} in this space.`, "Read the suggestions with mem.suggestions, then choose one.")
    }
    const origin = isPlainObject(proposal.source) ? proposal.source : {}
    if (typeof origin.session !== "string" || !origin.session) {
      // A proposal with no turn behind it is a review item, not a suggestion:
      // it is decided in review, never dismissed here.
      throw notFound(`No suggestion ${id} in this space.`, "Proposals without a turn are decided in review.list, not dismissed.")
    }
    if (proposal.status !== "proposed" && proposal.status !== "accepting") {
      throw actRefused("not_pending", { id, status: proposal.status, version: proposal.version })
    }
    const revision = Number.isSafeInteger(body.revision) ? body.revision : Number.isSafeInteger(preview?.revision) ? preview.revision : null
    if (revision === null) {
      throw invalid("invalid_request", "Dismissing a suggestion names the version the person saw.", "Read its preview again, then press the same input.")
    }
    if (proposal.version !== revision) {
      throw actRefused("revision_conflict", { id, status: proposal.status, version: proposal.version })
    }
    const kind = String(proposal.type ?? "")
    const now = this.#nowIso()
    const fields = { ...proposal.fields, suggestion_dismissed_at: now, ...(body.forever === true ? { suggestion_off: kind } : {}) }
    if (body.forever === true && kind) {
      handle.run("insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value", `suggestion_off:${kind}`, now)
    }
    const saved = this.#save(handle, proposal, { ...proposal, fields }, this.#change(a, body.forever === true ? "dismiss_forever" : "dismiss"))
    return { id, state: saved.status, version: saved.version, count: 1 }
  }

  /**
   * The suggestion kinds this space has turned off (#77, `suggestion.dismiss`
   * with `forever`): the `suggestion_off:<kind>` meta rows' kinds, never any
   * other meta. `mem.suggestions` reads it before it raises one.
   */
  /**
   * #77's undo: turn one suggestion kind back on in this space, from Memory's
   * console. It is a browser session's change, as editing a held write is
   * (P1): no key, connect token or agent credential reaches it, and it is not a
   * Jelly action. A kind that is not off answers `removed: 0`; nothing else
   * changes.
   */
  async suggestionOptin(input, actor) {
    const a = normalizeActor(actor)
    requireObject(input, "space.suggestion-optin")
    if (a.credential !== "session") {
      throw new RecordsError(
        403,
        "session_required",
        "Turning suggestions back on is done by the person in a browser, in Memory's console (Review), not with a key or an agent's token.",
        "Open Memory's console, Review, and turn the kind back on there.",
      )
    }
    requireRole(a, "viewer", "Changing what this space suggests needs a role in it")
    const kind = String(input.kind ?? "").trim()
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(kind)) {
      throw invalid("invalid_request", "a suggestion kind is a lower-case word, such as team_write.", "Read the muted kinds with space.suggestion-optouts, then name one.")
    }
    const handle = this.#writer(a)
    const removed = Number(handle.run("delete from meta where key = ?", `suggestion_off:${kind}`).changes)
    return { kind, removed }
  }

  async suggestionOptouts(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reading what this space suggests needs a role in it")
    requireObject(input, "space.suggestion-optouts")
    const handle = this.#reader()
    const kinds = handle
      .all("select key from meta where key like 'suggestion_off:%'")
      .map((row) => String(row.key).slice("suggestion_off:".length))
      .filter(Boolean)
    return { kinds: kinds.sort() }
  }

  /**
   * The console's edit of a held team write (`review.edit`): its author, in
   * their personal space, at the version `review.list` gave them. The words
   * are the same change the `write.decide` action makes (A15), never a second
   * implementation of it; the proposal stays theirs while it waits, and
   * nothing reaches the shared space until it is accepted there.
   */
  async editHeldWrite(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "review.edit")
    requireRole(a, "editor", "Editing a held write needs the editor role in this space")
    // P1, checked here as well as at the gateway: the words the person is about
    // to approve are theirs to correct in Memory's console, at a browser. The
    // gateway sets `credential: "session"` only after its cookie, CSRF and
    // Origin checks, so no key, connect token or agent credential edits them.
    if (a.credential !== "session") {
      throw new RecordsError(
        403,
        "session_required",
        "Editing a held write's words is done by the person in a browser, in Memory's console (Review), not with a key or an agent's token.",
        "Open Memory's console, Review, and edit the held write there; an agent decides what it proposed by asking the person.",
      )
    }
    const id = requireId(body.id)
    const proposal = this.#load(this.#existing(a), id)
    if (!proposal || proposal.kind !== "proposal" || proposal.type !== "team_write" || !visibleRecord(a, proposal)) {
      throw notFound(`No held write ${id} in this space.`, "Held writes wait in review.list, in your own space.")
    }
    if (proposal.author.user !== a.user) throw forbidden("Only the write's author edits it.")
    if (!Number.isSafeInteger(body.revision)) throw invalid("invalid_request", "An edit names the version of the write the person saw.", "Send revision: the version review.list returned.")
    if (proposal.version !== body.revision) {
      throw conflict("version_conflict", "The write changed since it was read.", "Read it again before editing it.", { current: pub(proposal) })
    }
    return this.#editHeldWrite(this.#existing(a), a, proposal, body.text)
  }

  /**
   * A1: a page's words, at the version the person saw. A team space is
   * `needs_approval`: the person approves a shared page in Memory's own page, so
   * nothing is written here. `expectVersion` 0 means "the page must not exist
   * yet"; an update always carries the version it changes.
   */
  applyActPageWrite({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "page.write")
    const kind = handle?.meta?.space_kind ?? a.spaceKind
    if (kind !== "personal") throw actRefused("needs_approval")
    const pagePath = checkPath(body.path)
    if (typeof body.body !== "string") throw invalid("invalid_record", "A page write needs its words.", "Send body as the page's text.")
    const current = this.#loadByPath(handle, pagePath)
    if (!canWrite(a, pagePath)) throw actRefused("space_read_only")
    if (body.expectVersion !== undefined) {
      if (!Number.isSafeInteger(body.expectVersion) || body.expectVersion < 0) {
        throw invalid("invalid_request", "expectVersion is the page's version the person saw.", "Send the whole number review.list or pages.read gave, or 0 for a new page.")
      }
      if (current ? current.version !== body.expectVersion : body.expectVersion !== 0) {
        throw actRefused("revision_conflict", { id: current?.id ?? null, path: pagePath, version: Number(current?.version ?? 0) })
      }
    } else if (current) {
      throw actRefused("revision_conflict")
    }
    // The action's input names no type (a person writes words at a path), so a
    // new page takes the type its first path segment names, or `topic`.
    const record = {
      kind: "page",
      type: current?.type ?? pageTypeOf(pagePath),
      path: pagePath,
      body: body.body,
      ...(current ? { base_version: current.version } : {}),
    }
    const done = this.#put({ record, upsert_path: true }, a, null)
    return { id: done.record.id, version: done.record.version }
  }

  /**
   * A12: the erasure receipt. The profile is the memory core's, so records
   * spends the grant and keeps the receipt it returns; the plugin re-reads the
   * profile, refuses `revision_conflict` if it is no longer the snapshot the
   * person saw, and erases. An interrupted erase leaves `erasing`, which is what
   * the page says.
   */
  applyActProfileErase({ input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, "profile.erase")
    if (typeof body.phrase !== "string" || !body.phrase.trim() || body.phrase.length > 300) {
      throw invalid("invalid_request", "An erase needs the phrase the person chose, up to 300 characters.", "Send the phrase profile.erase.preview listed.")
    }
    if (typeof body.snapshot !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(body.snapshot)) {
      throw invalid("invalid_request", "An erase needs the profile's snapshot digest, as profile.erase.preview returned it.", "Read the preview again, then press.")
    }
    // The erase itself spans services: the profile is the memory core's, and
    // records cannot reach it. So this act **reserves** the grant — verified,
    // bound to this person, spent once, with its audit row, in this transaction
    // — and nothing is erased until the plugin has this answer. The plugin then
    // erases and settles the receipt (`acts.settle`), which is the one call that
    // makes it terminal. A refused grant reaches neither the erase nor a row.
    // The audit row outlives the ledger's cleanup, so the decision is on record
    // even after the spent grant is pruned. Ids only: no phrase, no line.
    handle.run(
      "insert into delete_audit (at, action, record_id, record_kind, actor_user, principal, credential, space) values (?, ?, ?, ?, ?, ?, ?, ?)",
      this.#nowIso(),
      "profile.erase",
      "profile",
      "profile",
      a.user,
      a.principal === "agent" ? "agent" : "user",
      "grant",
      this.#spaceId ?? a.space ?? null,
    )
    return { erased: 0, state: "pending", snapshot: body.snapshot }
  }

  /**
   * A space or sharing act's reservation (A2–A9, A11). The change is made by
   * the plugin through the control plane and the records service, which decide
   * access; this service **reserves** the grant — verified, bound to the person,
   * spent once in this transaction — and records the audit row that outlives the
   * ledger. The plugin then runs the operation as the person and calls
   * `acts.settle`, which is the one call that makes the receipt terminal. A
   * refused grant reaches neither the operation nor a row.
   */
  reserveAct({ act, input, actor, handle, claims }) {
    const a = this.#actActor(normalizeActor(actor), claims)
    const body = requireObject(input, act)
    handle.run(
      "insert into act_audit (at, act, host, jti, user_id, device, class, space, outcome) values (?, ?, ?, ?, ?, ?, ?, ?, 'pending')",
      this.#nowIso(),
      act,
      claims.iss,
      claims.jti,
      a.user,
      claims.dev,
      claims.cls,
      // The space the press was about: the one the act's `store` path names (a
      // copy names where it copies from, a share its target), else the input's
      // `space`, else the store itself.
      this.#namedSpace(this.#settings.acts.get(act), body) || (typeof body.space === "string" && body.space) || this.#spaceId || a.space || null,
    )
    return { state: "pending", act }
  }

  /**
   * acts.settle: the outcome of an act whose change spans services, once it has
   * happened (§4.7). Only a reservation this caller made, still `pending`, can
   * be settled, and only a terminal state the act declares (`profile.erase`:
   * `erased` or `refused`; A2–A9 and A11: `applied` or `refused`): the receipt
   * never says a change happened before it did, and never leaves a pressed act
   * without one.
   */
  async settleGrant(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "acts.settle")
    // Only the host's own action path settles: the same verified view that
    // applied the grant, over the person's Jelly ID credential. An agent
    // credential of the same user could otherwise write a receipt for an erase
    // it never saw, and a console session is a different door.
    if (a.identity?.principal !== "person" || a.credential === "session") {
      throw forbidden("Only the host's own action settles a reservation: this call did not come through it.", "Press the action again in the host, which settles its own reservation. An agent or a console session cannot write its receipt.")
    }
    const extra = Object.keys(body).filter((key) => !["act", "host", "jti", "state", "erased", "id"].includes(key))
    if (extra.length > 0) throw invalid("invalid_request", `acts.settle does not accept ${extra.map((key) => JSON.stringify(key)).join(", ")}.`, "Send exactly {act, host, jti, state, erased?, id?}.")
    const declared = typeof body.act === "string" ? this.#settings.acts.get(body.act) : undefined
    if (!declared || !Array.isArray(declared.settle)) throw grantRefused("grant_action")
    if (!declared.settle.includes(body.state)) {
      throw invalid("invalid_request", `A settle of ${body.act} is ${declared.settle.join(" or ")}, not ${JSON.stringify(body.state ?? null)}.`, "Send the outcome the act reached.")
    }
    if (body.erased !== undefined && (!Number.isSafeInteger(body.erased) || body.erased < 0)) {
      throw invalid("invalid_request", "erased is the whole number of lines the erase removed.", "Send a count, or leave it out.")
    }
    if (body.erased !== undefined && body.act !== "profile.erase") {
      throw invalid("invalid_request", "erased is an erase's count, and this act has none.", "Send only the act and the outcome.")
    }
    // The id of what the act made, when it made something and the outcome is
    // not the whole of the answer (a move that copied and could not remove).
    if (body.id !== undefined && (typeof body.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,199}$/.test(body.id))) {
      throw invalid("invalid_request", "id is the record an act made, if it made one.", "Send the id the act answered, or leave it out.")
    }
    if (typeof body.host !== "string" || !body.host || typeof body.jti !== "string" || !/^[A-Za-z0-9_-]{22,128}$/.test(body.jti)) {
      throw invalid("invalid_request", "A settle names the grant it completes: its host and jti.", "Send the spent host and jti the reserve answered.")
    }
    const handle = this.#existing(a)
    if (handle) this.#sweepPending(handle)
    const row = handle?.get("select user_id, act, receipt from act_grants where host = ? and jti = ?", body.host, body.jti)
    // Another person's grant is not this caller's to settle, and is not found.
    if (!row || row.user_id !== a.user) throw notFound(`No grant ${body.jti} waits for you.`, "Settle only the reservation your own act answered.")
    if (row.act !== body.act) throw grantRefused("grant_action")
    const pending = parse(row.receipt, null)
    if (pending?.state !== "pending") throw actRefused("not_pending")
    return handle.tx(() => {
      const receipt = { state: body.state, ...(body.act === "profile.erase" ? { snapshot: pending.snapshot ?? null } : {}), ...(body.erased === undefined ? {} : { erased: body.erased }), ...(body.id === undefined ? {} : { id: body.id }) }
      handle.run("update act_grants set receipt = ? where host = ? and jti = ?", JSON.stringify(receipt), body.host, body.jti)
      // The outcome outlives the ledger, so a person or an operator can see what
      // an act did after its receipt is pruned.
      handle.run("update act_audit set outcome = ?, item = ? where host = ? and jti = ?", body.state, body.id ?? null, body.host, body.jti)
      return { act: body.act, receipt, settled: { host: body.host, jti: body.jti } }
    })
  }

  /**
   * A reservation whose settle never came (§4.7, the crash window): past the
   * grant's own window, what Memory cannot know is recorded as `unrecorded` —
   * the change may or may not have happened — rather than left `pending` for
   * ever. The audit row written at the reservation keeps the attempt either
   * way. Its receipt is kept too: it is the server's own account of the act.
   */
  #sweepPending(handle) {
    const cutoff = Math.floor(this.#settings.now().getTime() / 1000) - 300
    const swept = handle.all("select host, jti from act_grants where exp < ? and json_extract(receipt, '$.state') = 'pending'", cutoff)
    const changed = Number(
      handle.run(
        `update act_grants set receipt = json_set(receipt, '$.state', 'unrecorded')
         where exp < ? and json_extract(receipt, '$.state') = 'pending'`,
        cutoff,
      ).changes,
    )
    for (const row of swept) handle.run("update act_audit set outcome = 'unrecorded' where host = ? and jti = ?", row.host, row.jti)
    return changed
  }

  /** Delete grants 300 s past their expiry, at most once a minute on the act path (§4.8). */
  #pruneGrants(handle) {
    const now = this.#settings.now().getTime()
    if (now - handle.grantsPrunedAt < 60_000) return 0
    handle.grantsPrunedAt = now
    this.#sweepPending(handle)
    // An erasure's receipt stays: it is the one server-side record of the act
    // besides its audit row, and a sweep may have just made it terminal.
    const grants = Number(handle.run("delete from act_grants where exp < ? and act <> 'profile.erase'", Math.floor(now / 1000) - 300).changes)
    // A preview nobody pressed ends with its own window (0.11): a press that
    // finds none asks for a fresh preview, which is the honest answer.
    handle.run("delete from act_previews where exp <= ?", Math.floor(now / 1000))
    return grants
  }

  /** A record at the version a write produced, if the caller can read it now; else null. */
  #recordAt(handle, actor, ref) {
    if (!ref || typeof ref.id !== "string") return null
    const current = this.#load(handle, ref.id)
    if (!current || !visibleRecord(actor, current)) return null
    if (current.version === ref.version) return pub(current)
    const row = handle.get("select snapshot from versions where record_id = ? and version = ?", ref.id, ref.version)
    const snapshot = row ? parse(row.snapshot, null) : null
    if (!snapshot) return pub(current)
    return visibleRecord(actor, snapshot) ? pub(snapshot) : null
  }

  /** The original result of a keyed write, rebuilt from its receipt and checked against the caller's access now. */
  #replay(handle, actor, method, digest, prior) {
    if (prior.method !== method || prior.digest !== digest) {
      throw conflict("idempotency_conflict", "This key was used for a different write.", "Use a new key for a new write; a key is never reused for a changed request.")
    }
    const receipt = parse(prior.receipt, {})
    if (method === "records.revise" && Array.isArray(receipt.results)) {
      const done = receipt.results.filter((item) => item.ok).length
      return {
        action: receipt.action,
        results: receipt.results,
        done,
        failed: receipt.results.length - done,
        ...(receipt.links_removed !== undefined ? { links_removed: receipt.links_removed } : {}),
        ...(receipt.purge_id ? { purge_id: receipt.purge_id } : {}),
        replayed: true,
      }
    }
    if (method === "records.delete") {
      return { deleted: receipt.deleted ?? [], links_removed: receipt.links_removed ?? 0, missing: receipt.missing ?? [], replayed: true }
    }
    if (method === "records.move" && Array.isArray(receipt.moved)) {
      const records = receipt.moved.map((ref) => this.#recordAt(handle, actor, ref)).filter(Boolean)
      const rewritten = (receipt.rewritten ?? []).filter((id) => {
        const other = this.#load(handle, id)
        return Boolean(other && visibleRecord(actor, other))
      })
      return { records, moved: records.map((record) => ({ id: record.id, to: record.path })), rewritten_links: receipt.rewritten_links ?? 0, rewritten, conflicts: [], replayed: true }
    }
    const record = this.#recordAt(handle, actor, receipt.record)
    if (!record) return { record: null, record_id: receipt.record?.id ?? null, replayed: true, unavailable: true }
    const out = { record }
    if (method === "records.put") {
      out.created = receipt.created === true
      if (receipt.superseded?.length) out.superseded = receipt.superseded
    }
    if (method === "records.revise" && Number.isInteger(receipt.versions_removed)) {
      out.versions_removed = receipt.versions_removed
      if (receipt.purge_id) out.purge_id = receipt.purge_id
    }
    if (method === "records.revise" && receipt.superseded_record) {
      out.superseded = this.#recordAt(handle, actor, receipt.superseded_record) ?? { id: receipt.superseded_record.id }
    }
    if (method === "records.move") {
      out.rewritten_links = receipt.rewritten_links ?? 0
      out.rewritten = (receipt.rewritten ?? []).filter((id) => {
        const other = this.#load(handle, id)
        return Boolean(other && visibleRecord(actor, other))
      })
    }
    out.replayed = true
    return out
  }

  #load(handle, id) {
    const row = handle.get("select * from records where id = ?", id)
    return row ? fromRow(row) : null
  }

  #loadByPath(handle, recordPath) {
    const row = handle.get("select * from records where path = ?", recordPath)
    return row ? fromRow(row) : null
  }

  #change(actor, action, extra = {}) {
    // An act's write says which grant made it (§4.8): host, device, class and
    // jti, never the grant itself and never the input.
    const grant = actor?.grant
    return {
      action,
      ...(grant ? { via: "grant", host: grant.host, device: grant.device, class: grant.class, jti: grant.jti } : {}),
      ...extra,
      // `principal` is the gateway's verified credential (x-records-principal):
      // "agent" only for an agent credential, "user" for a person's own. The
      // agent's *name* rides alongside it and is never what decides whose words
      // these are — a person's own coding agent carries one too (0.11 review).
      by: { user: actor.user, agent: actor.agent, principal: actor.principal === "agent" ? "agent" : "user", session: actor.session, space: actor.space },
      at: this.#nowIso(),
    }
  }

  #writeEdges(handle, record) {
    // A `cite` edge outlives the version that made it: an older version still
    // holds the quote a removal must take, so only erasing the record drops
    // them (0.11 review R5-B1).
    handle.run("delete from links where src = ? and type <> 'cite'", record.id)
    for (const dst of record.links) handle.run("insert or ignore into links (src, dst, type) values (?, ?, 'link')", record.id, dst)
    for (const dst of record.supersedes) handle.run("insert or ignore into links (src, dst, type) values (?, ?, 'supersedes')", record.id, dst)
    for (const key of ["event", "turn", "record"]) {
      if (record.source?.[key]) handle.run("insert or ignore into links (src, dst, type) values (?, ?, 'source')", record.id, record.source[key])
    }
    for (const event of citeEventsOf(record)) handle.run("insert or ignore into links (src, dst, type) values (?, ?, 'cite')", record.id, event)
  }

  #insert(handle, record) {
    handle.run(
      `insert into records (id, kind, type, path, title, body, extra, status, stated_by, fields, supersedes, superseded_by,
        source, task, author_user, author_agent, owner, links, change, created, updated, version)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      record.id,
      record.kind,
      record.type,
      record.path,
      record.title,
      record.body,
      searchExtra(record.fields),
      record.status,
      record.stated_by,
      JSON.stringify(record.fields),
      JSON.stringify(record.supersedes),
      record.superseded_by,
      JSON.stringify(record.source),
      record.task,
      record.author.user,
      record.author.agent,
      record.owner,
      JSON.stringify(record.links),
      JSON.stringify(record.change),
      record.created,
      record.updated,
      record.version,
    )
    this.#writeEdges(handle, record)
  }

  /** Store `next` as the new version of `current`, keeping `current` in versions. */
  #save(handle, current, next, change) {
    const nowIso = this.#nowIso()
    handle.run(
      "insert or replace into versions (record_id, version, snapshot, saved) values (?, ?, ?, ?)",
      current.id,
      current.version,
      JSON.stringify(current),
      nowIso,
    )
    const saved = {
      ...next,
      id: current.id,
      kind: current.kind,
      created: current.created,
      author: current.author,
      version: current.version + 1,
      updated: nowIso,
      links: current.kind === "proposal" && current.type === "team_write" ? [] : deriveLinks(next.body, next.fields?.links),
      change,
    }
    handle.run(
      `update records set type = ?, path = ?, title = ?, body = ?, extra = ?, status = ?, stated_by = ?, fields = ?,
        supersedes = ?, superseded_by = ?, source = ?, task = ?, owner = ?, links = ?, change = ?, updated = ?, version = ?
       where id = ?`,
      saved.type,
      saved.path,
      saved.title,
      saved.body,
      searchExtra(saved.fields),
      saved.status,
      saved.stated_by,
      JSON.stringify(saved.fields),
      JSON.stringify(saved.supersedes),
      saved.superseded_by,
      JSON.stringify(saved.source),
      saved.task,
      saved.owner,
      JSON.stringify(saved.links),
      JSON.stringify(saved.change),
      saved.updated,
      saved.version,
      saved.id,
    )
    // The index page is where the lane rule reads the person's confirmed
    // identities, so any write to it makes the cached person stale: an update, a
    // merge proposal that adds an identity, or a link (§6, review L3).
    if (saved.path === "index") this.#forgetIngestPerson(handle)
    this.#writeEdges(handle, saved)
    return saved
  }

  /**
   * Tombstones for a record a person deletes or forgets (FABLE records #2):
   * its routine key, and for a memory or commitment the turn or event it
   * cites, so a later run of the day never writes it back. Proposal expiry
   * and space purge do not call this.
   *
   * A source ref is stored as a keyed hash (design §8.5): the space's text key
   * over the ref, never the ref itself, as `records/src/forgotten.js` does for
   * text tombstones. Rows written before this build keep their plain `ref:`
   * form and are still read (see `#routineBlock`).
   */
  #tombstone(handle, record) {
    if (!record) return
    const keys = []
    const routineKey = record.fields?.routine_key
    if (typeof routineKey === "string" && routineKey) keys.push(`key:${routineKey}`)
    // A job's proposal is keyed by its item; deleting it must stop the next run
    // writing it again (J4 review, finding 4).
    const jobKey = record.fields?.job_key
    if (typeof jobKey === "string" && jobKey) keys.push(`key:${jobKey}`)
    const now = this.#nowIso()
    for (const key of keys) handle.run("insert into routine_tombstones (key, created) values (?, ?) on conflict(key) do nothing", key.slice(0, 600), now)
    // The refs, keyed: a delete or forget writes both forms, so a routine and a
    // re-ingest find it, and the file alone never holds the id in clear.
    if (record.kind === "memory" || record.kind === "commitment") {
      this.#refTombstones(handle, [record.source?.turn, record.source?.event].filter((ref) => typeof ref === "string" && ref), now)
    }
    // Text tombstones (routine-safety review, item 3): the service's own, so a
    // verbatim mention stays forgotten even when the client's fingerprint is missing.
    if (record.kind === "memory" || record.kind === "commitment") {
      const sentences = substantiveSentences({ title: record.title, body: record.body, what: record.fields?.what })
      if (sentences.length > 0) this.#textTombstones(handle, sentences, now)
    }
  }

  /**
   * A keyed hash of each source ref, under the space's tombstone key (design
   * §8.5): the same ref always hashes the same, and no id is stored in clear.
   * Two marks: `refh:` is a deleted record's source ref, which a routine may
   * not write a claim about again; `gone:` is an item a person forgot, which a
   * re-sync may not bring back either. Inserted inside a write.
   */
  #refTombstones(handle, refs, now, mark = "refh") {
    if (refs.length === 0) return 0
    const key = this.#forgetTextKey(handle, true)
    this.#rewriteLegacyRefTombstones(handle, key, now)
    let written = 0
    for (const ref of refs) {
      handle.run("insert into routine_tombstones (key, created) values (?, ?) on conflict(key) do nothing", `${mark}:${hashTerm(key, ref)}`.slice(0, 600), now)
      written += 1
    }
    return written
  }

  /**
   * A build before this one wrote a source ref's tombstone in clear (`ref:`).
   * The first write that has the space's key rewrites them as keyed hashes
   * (design §8.5), once per file: the ref is still blocked, and the file no
   * longer holds an id in clear.
   */
  #rewriteLegacyRefTombstones(handle, key, now) {
    if (handle.get("select value from meta where key = 'ref_tombstones_v2'")) return 0
    let rewritten = 0
    for (const row of handle.all("select key from routine_tombstones where key like 'ref:%'")) {
      const ref = String(row.key).slice("ref:".length)
      handle.run("delete from routine_tombstones where key = ?", row.key)
      if (ref) {
        handle.run("insert into routine_tombstones (key, created) values (?, ?) on conflict(key) do nothing", `refh:${hashTerm(key, ref)}`.slice(0, 600), now)
        rewritten += 1
      }
    }
    handle.run("insert into meta (key, value) values ('ref_tombstones_v2', ?) on conflict(key) do update set value = excluded.value", now)
    return rewritten
  }

  /** The keyed hash of one ref under the space's key, or null when the space has none yet. */
  #refHash(handle, ref) {
    const key = this.#forgetTextKey(handle, false)
    return key ? hashTerm(key, ref) : null
  }

  /** True when a source ref was forgotten or deleted: its keyed hash, or a row from before this build. */
  #refTombstoned(handle, ref) {
    if (typeof ref !== "string" || !ref) return false
    if (handle.get("select 1 as hit from routine_tombstones where key = ?", `ref:${ref}`)) return true
    const hash = this.#refHash(handle, ref)
    if (!hash) return false
    return Boolean(handle.get("select 1 as hit from routine_tombstones where key in (?, ?) limit 1", `refh:${hash}`, `gone:${hash}`))
  }

  /**
   * True when a held claim's ref still exists: an event row, or a turn the
   * person has not forgotten. A turn is never an event row, so its absence
   * there says nothing (design §5.4).
   */
  #refAlive(handle, ref) {
    if (handle.get("select 1 as hit from events where id = ?", ref)) return true
    if (this.#refForgotten(handle, ref)) return false
    return !/^evt_/.test(String(ref))
  }

  /** True when a person forgot this item: a re-sync of it is refused, and it never returns. */
  #refForgotten(handle, ref) {
    if (typeof ref !== "string" || !ref) return false
    const hash = this.#refHash(handle, ref)
    if (!hash) return false
    return Boolean(handle.get("select 1 as hit from routine_tombstones where key = ?", `gone:${hash}`))
  }


  /** Text tombstones for normalised sentences, under the space's key (inside a write). */
  #textTombstones(handle, sentences, now) {
    const key = this.#forgetTextKey(handle, true)
    for (const words of sentences) handle.run("insert into forgotten_texts (hash, words, created) values (?, ?, ?) on conflict(hash) do nothing", textHash(key, words), words.length, now)
  }

  /**
   * The key new text tombstones are written with. With the service's forget
   * secret it is derived from it and never stored; without one it is the
   * space's random key in meta, made on first use (inside a write).
   */
  #forgetTextKey(handle, create) {
    if (this.#settings.forgetSecret) return textTombstoneKey(this.#settings.forgetSecret, this.#spaceId)
    const row = handle.get("select value from meta where key = 'forget_text_key'")
    if (row || !create) return row?.value ?? null
    const key = newForgottenKey()
    handle.run("insert into meta (key, value) values ('forget_text_key', ?)", key)
    return key
  }

  /**
   * Every key a stored tombstone may be under: the current one, and the
   * space's stored key from before the secret was set (those tombstones keep
   * it; docs/design/forget-erase.md, the residual).
   */
  #forgetTextKeys(handle) {
    const keys = []
    const current = this.#forgetTextKey(handle, false)
    if (current) keys.push(current)
    if (this.#settings.forgetSecret) {
      const stored = handle.get("select value from meta where key = 'forget_text_key'")?.value
      if (stored && !keys.includes(stored)) keys.push(stored)
    }
    return keys
  }

  /** True when a run of a text's words equals a text tombstone. */
  #textTombstoned(handle, texts) {
    const lengths = handle.all("select distinct words from forgotten_texts").map((row) => Number(row.words))
    if (lengths.length === 0) return false
    const keys = this.#forgetTextKeys(handle)
    if (keys.length === 0) return false
    const hashes = new Set()
    for (const text of texts) {
      const words = normalWords(text)
      for (const key of keys) for (const n of lengths) for (let i = 0; i + n <= words.length; i += 1) hashes.add(textHash(key, words.slice(i, i + n)))
    }
    const list = [...hashes]
    for (let i = 0; i < list.length; i += 500) {
      const chunk = list.slice(i, i + 500)
      if (handle.get(`select 1 as hit from forgotten_texts where hash in (${chunk.map(() => "?").join(", ")}) limit 1`, ...chunk)) return true
    }
    return false
  }

  /**
   * Why a routine may not write an item, or null: a tombstoned routine key,
   * a tombstoned source ref (its keyed hash, or a row from before this build),
   * or text that copies a forgotten fingerprint of any author in the space
   * (the keyed hashes; no text is kept).
   */
  #routineBlock(handle, { key, refs = [], texts = [] }, matcher) {
    const has = (k) => Boolean(handle.get("select 1 as hit from routine_tombstones where key = ?", k))
    if (typeof key === "string" && key && has(`key:${key}`)) return "tombstone"
    for (const ref of refs) if (typeof ref === "string" && ref && this.#refTombstoned(handle, ref)) return "forgotten_ref"
    if (texts.length > 0 && this.#textTombstoned(handle, texts)) return "forgotten_text"
    const m = matcher ?? this.#forgottenMatcher(handle)
    if (m.size > 0 && texts.some((text) => m.matches(text).length > 0)) return "forgotten_text"
    return null
  }

  /** Every author's forgotten fingerprints in this space, as one matcher. */
  #forgottenMatcher(handle) {
    const keys = handle.all("select author_user, key from forgotten_keys")
    if (keys.length === 0) return { size: 0, matches: () => [] }
    const authors = keys.map((row) => ({
      key: row.key,
      fingerprints: handle.all("select id, fingerprint from forgotten_prints where author_user = ?", row.author_user).map((p) => ({ id: p.id, ...parse(p.fingerprint, {}) })),
    }))
    return spaceMatcher(authors)
  }

  /**
   * SEC-0912 (F11): the ids-only audit row of a delete, forget or retire, in
   * the caller's transaction, so it commits and rolls back with the change.
   * Never content: no title, body, path or fields.
   */
  #auditDelete(handle, a, record, action) {
    if (!record) return
    const system = a?.user === ROUTINE_USER
    handle.run(
      "insert into delete_audit (at, action, record_id, record_kind, actor_user, principal, credential, space) values (?, ?, ?, ?, ?, ?, ?, ?)",
      this.#nowIso(),
      action,
      record.id,
      record.kind,
      a?.user ?? ROUTINE_USER,
      system ? "system" : a?.principal === "agent" ? "agent" : "user",
      system ? "system" : a?.credential === "session" ? "session" : "bearer",
      this.#spaceId ?? a?.space ?? null,
    )
  }

  #hardDelete(handle, id) {
    removeDerivativeEdges(handle, id)
    handle.run("delete from versions where record_id = ?", id)
    const links = Number(handle.run("delete from links where src = ?", id).changes)
    // A note in `shared_copies` is **kept**: deleting a record here does not
    // delete its copy in another space, so the copy is still one Memory cannot
    // retract, and a later removal must still report it (0.11 review, B2).
    handle.run("delete from records where id = ?", id)
    return links
  }

  #invalidateSilver(handle, scope) {
    const result = invalidateSilver(handle, scope, (id) => {
      const record = handle.get("select kind from records where id=?", id)
      if (record) this.#auditDelete(handle, SYSTEM_ACTOR, { id, kind: record.kind }, "forget")
      this.#hardDelete(handle, id)
    })
    if (result.evidence > 0 || result.derivatives > 0) handle.erasePending = true
    return result
  }

  /**
   * The predecessors a forget of `id` erases: every record `id` supersedes,
   * directly or through others (the links table and the superseded_by
   * column), that the caller may delete by records.delete's rules. One the
   * caller may not delete is left, and named with its error code; the walk
   * goes on through it, so an older wording the caller may delete still goes.
   */
  #lineage(handle, a, id, erased) {
    const predecessors = []
    const left = []
    const seen = new Set([id])
    let frontier = [id]
    while (frontier.length > 0 && seen.size <= MAX_LINEAGE) {
      const next = []
      for (const node of frontier) {
        const older = [
          ...handle.all("select dst as other from links where src = ? and type = 'supersedes'", node),
          ...handle.all("select id as other from records where superseded_by = ?", node),
        ]
        for (const { other } of older) {
          if (seen.has(other) || erased.has(other)) continue
          seen.add(other)
          const record = this.#load(handle, other)
          if (!record) continue
          next.push(other)
          try {
            this.#deleteAccess(a, record, other, handle.meta)
            predecessors.push(record)
          } catch (error) {
            if (!(error instanceof RecordsError)) throw error
            // A record the caller cannot see is not named: its existence is not theirs to learn.
            if (error.status !== 404) left.push({ id: other, code: error.code })
          }
        }
      }
      frontier = next
    }
    return { predecessors, left }
  }

  /** The normalised sentences of a record and of each of its stored versions, for a purge entry. */
  #erasedSentences(handle, record) {
    const out = substantiveSentences({ title: record.title, body: record.body, what: record.fields?.what })
    for (const row of handle.all("select snapshot from versions where record_id = ?", record.id)) {
      const old = parse(row.snapshot, null)
      if (old) out.push(...substantiveSentences({ title: old.title, body: old.body, what: old.fields?.what }))
    }
    return out
  }

  /**
   * One purge entry for `user` (docs/design/forget-erase.md): the salted
   * hashes of the sentences a forget erased. Returns its id, or null when
   * there is nothing to hash. Inside the forget's transaction.
   */
  #writePurge(handle, user, sentences) {
    if (!user || sentences.length === 0) return null
    const now = this.#settings.now()
    const id = `pg_${ulid(now.getTime())}`
    const secret = this.#settings.forgetSecret
    const salt = purgeSalt(secret, this.#spaceId, id)
    const { hashes, lengths } = purgeHashes(salt, sentences)
    if (hashes.length === 0) return null
    const expires = new Date(now.getTime() + PURGE_WINDOW_DAYS * 86_400_000).toISOString()
    handle.run(
      "insert into forget_purges (id, author_user, created, expires, salt, lengths, hashes) values (?, ?, ?, ?, ?, ?, ?)",
      id,
      user,
      now.toISOString(),
      expires,
      secret ? null : salt,
      JSON.stringify(lengths),
      JSON.stringify(hashes),
    )
    return id
  }

  /**
   * After a forget commits: move every WAL frame into the file and truncate
   * the WAL to zero bytes, so the frames that held the erased rows are gone
   * from it (secure_delete has already zeroed the rows in the pages the
   * checkpoint writes). A reader in the way leaves it pending; maintenance
   * tries again.
   */
  #eraseFile() {
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle || !handle.file) return { secure_delete: true, wal: "none" }
    return { secure_delete: true, wal: this.#truncateWal(handle) }
  }

  #truncateWal(handle) {
    const row = handle.db.prepare("pragma wal_checkpoint(TRUNCATE)").get()
    const busy = Number(row?.busy ?? 0) !== 0
    handle.erasePending = busy
    return busy ? "pending" : "truncated"
  }

  /**
   * records.revise `{id, action: "forget_versions"}`: erase every stored
   * earlier version of one record and keep its current one, so text edited
   * out of a page is gone (FABLE records #3). records.delete's rules decide
   * who may: an editor for their own memory, an admin or owner for a page or
   * someone else's record. The erased sentences that the current version does
   * not hold become a purge entry and text tombstones.
   */
  #forgetVersions(body, a, hook) {
    const id = requireId(body.id)
    const handle = this.#existing(a)
    const current = handle ? this.#load(handle, id) : null
    if (!current || !visibleRecord(a, current)) throw notFound(`No record ${id} in this space.`, "Check the id with records.search (status: \"all\").")
    if (!canWrite(a, current.path)) throw forbidden("You can read this record but not change it.")
    this.#deleteAccess(a, current, id, handle.meta)
    return handle.tx(() => {
      const fresh = this.#load(handle, id)
      if (!fresh) throw notFound(`No record ${id} in this space.`, "Check the id with records.search.")
      this.#deleteAccess(a, fresh, id, handle.meta)
      const keep = new Set(substantiveSentences({ title: fresh.title, body: fresh.body, what: fresh.fields?.what }).map((words) => words.join(" ")))
      const sentences = this.#erasedSentences(handle, fresh).filter((words) => !keep.has(words.join(" ")))
      const removed = Number(handle.run("delete from versions where record_id = ?", id).changes)
      this.#auditDelete(handle, a, fresh, "forget_versions")
      if (sentences.length > 0) this.#textTombstones(handle, sentences, this.#nowIso())
      const purgeId = this.#writePurge(handle, a.user, sentences)
      const result = { record: pub(fresh), versions_removed: removed, ...(purgeId ? { purge_id: purgeId } : {}) }
      hook?.(handle, result)
      return result
    })
  }

  /** Mark each id superseded by `byId`; every one must exist and be writable. */
  #supersede(handle, ids, byId, actor) {
    const done = []
    for (const id of ids) {
      if (id === byId) continue
      const old = this.#load(handle, id)
      if (!old || !visibleRecord(actor, old) || (old.kind === "proposal" && old.type === "team_write")) {
        throw notFound(`Record ${id} named in supersedes does not exist in this space.`, "Check the id with records.get, or leave it out of supersedes.")
      }
      if (!canWrite(actor, old.path)) throw forbidden(`You can read ${id} but not change it, so you cannot supersede it.`)
      // FIX-0914: superseding a page retires it, and a bearer's revise does not
      // retire a team page (#reviseAccess refuses it): same rule, same message.
      if (old.kind === "page" && bearerOnTeamPage(actor, handle.meta)) {
        throw pageLinesKept(`${id} is a page in a shared space; an agent does not revise it.`, "Add lines with records.append. The person retires, restores or forgets a team page in Memory's console.")
      }
      if (old.superseded_by && old.superseded_by !== byId) {
        throw conflict(
          "conflict",
          `${id} is already superseded by ${old.superseded_by}.`,
          `Supersede ${old.superseded_by} instead, or read the lineage with records.history.`,
        )
      }
      this.#save(handle, old, { ...old, status: "superseded", superseded_by: byId }, this.#change(actor, "superseded", { by_record: byId }))
      done.push(id)
    }
    return done
  }

  /** Create a checked record; the caller holds the transaction. */
  #create(handle, actor, fresh, change) {
    if (fresh.path) {
      const taken = handle.get("select id from records where path = ?", fresh.path)
      if (taken) {
        throw conflict("path_taken", `A page already lives at ${fresh.path} (${taken.id}).`, `Update it with records.put {record: {id: "${taken.id}", base_version, …}}, or send upsert_path: true; or choose another path.`, {
          id: taken.id,
        })
      }
    }
    const nowIso = this.#nowIso()
    const record = {
      id: recordId(this.#settings.now().getTime()),
      ...fresh,
      superseded_by: null,
      author: { user: actor.user, agent: actor.agent },
      created: nowIso,
      updated: nowIso,
      version: 1,
      links: fresh.kind === "proposal" && fresh.type === "team_write" ? [] : deriveLinks(fresh.body, fresh.fields?.links),
      change,
    }
    this.#insert(handle, record)
    const superseded = this.#supersede(handle, record.supersedes, record.id, actor)
    return { record, superseded }
  }

  #checkCreate(actor, fresh) {
    if (fresh.kind === "page" && typeof fresh.path === "string" && JOURNAL_PATH.test(fresh.path) && bearerOnTeamPage(actor)) {
      throw pageLinesKept(`${fresh.path} is a journal page, and a journal page is the person's own: it is never written in a shared space.`, "Write it in the personal space.")
    }
    if (fresh.kind !== "proposal" && fresh.status !== "current") {
      throw invalid("invalid_status", "New records start current.", "Create the record, then use records.revise to change its lifecycle status.")
    }
    if (!canWrite(actor, fresh.path)) {
      if (fresh.path && actor.role === "grant") throw forbidden(`You have no editor grant covering ${fresh.path}.`, "Ask the page's owner for an editor grant, or write where you have one.")
      requireRole(actor, "editor", fresh.path ? undefined : `Writing a ${fresh.kind} needs the editor role in this space`)
    }
    if (fresh.owner !== actor.user && !hasRole(actor, "admin")) {
      throw forbidden("Only an admin or the space's owner can create a record owned by someone else.", "Leave owner out; you own what you write.")
    }
    curate(fresh, actor)
  }

  #update(handle, actor, current, input, baseVersion, action = "update") {
    if (!canWrite(actor, current.path)) {
      throw forbidden(current.path ? `You can read ${current.path} but not change it.` : "You can read this record but not change it.")
    }
    const teamPage = current.kind === "page" && bearerOnTeamPage(actor, handle.meta)
    if (teamPage && (JOURNAL_PATH.test(String(current.path ?? "")) || JOURNAL_PATH.test(String(input.path ?? "")))) {
      throw pageLinesKept(`${current.path} is a journal page in a shared space; an agent does not write it.`)
    }
    if (baseVersion === undefined || baseVersion === null) {
      throw conflict("version_conflict", `${current.id} exists at version ${current.version}; an update must say which version it changes.`, `Read the record below, merge your change into it, and send base_version: ${current.version}.`, {
        current: pub(current),
      })
    }
    if (!Number.isInteger(baseVersion)) throw invalid("invalid_record", "base_version must be a whole number.", "Send the version you read.")
    if (baseVersion !== current.version) {
      throw conflict(
        "version_conflict",
        `${current.id} changed since you read it: you sent base_version ${baseVersion}, it is now at version ${current.version}.`,
        `Read the current record below, merge your change into it, and send base_version: ${current.version}.`,
        { current: pub(current) },
      )
    }
    if (current.kind !== "proposal" && input.status !== undefined && input.status !== current.status) {
      throw conflict("conflict", "A record's lifecycle status cannot be changed with records.put.", "Use records.revise to retire, restore, confirm or contest it.")
    }
    const next = markJournal(updatedRecord(current, input, actor, this.#nowIso()), actor)
    if (next.owner !== current.owner && current.owner !== actor.user && !hasRole(actor, "admin")) {
      throw forbidden("Only the record's owner or an admin can change its owner.", "Ask the owner to transfer it.")
    }
    // SEC-0912 (F9): in a shared space a bearer never changes a record's
    // owner, so it cannot make someone else's record its own and then delete
    // it. A page is the exception: its owner gives no bearer a delete (only
    // the console deletes a team page), and mem_share transfer sets it after
    // control's transfer. The console session and the routines may.
    if (next.owner !== current.owner && current.kind !== "page" && bearerOnTeamPage(actor, handle.meta)) {
      throw ownerChangeConsoleOnly(`${current.id} is in a shared space; a key or an agent does not change who owns it.`)
    }
    if (next.title !== current.title || next.body !== current.body || TEXT_FIELDS.some((key) => next.fields?.[key] !== current.fields?.[key])) curate(next, actor)
    // No caller-settable switch (re-review of f9f75609): a bearer's update of
    // a team page only inserts lines and keeps its title and type.
    if (teamPage) {
      const kept = teamPageLinesRefusal(current, next)
      if (kept) throw kept
    }
    const added = next.supersedes.filter((id) => !current.supersedes.includes(id))
    const saved = this.#save(handle, current, next, this.#change(actor, action))
    const superseded = this.#supersede(handle, added, saved.id, actor)
    return { record: saved, superseded }
  }

  // -------------------------------------------------------------------------
  // records.*

  /**
   * records.put: create without `id`; update with `id` and `base_version`;
   * `upsert_path` updates the page at `path`. Memory creates are not deduplicated
   * here: the plugin's bounded exact-match search is best effort, and long
   * inputs, concurrent creates, or a failed search can produce duplicates.
   *
   * An `idempotency_key` applies the write once (#keyed). Held team writes
   * (the proposal and its `held_batch`) and `migrate_legacy` keep their own
   * ledgers and are never routed through it.
   */
  async put(input, actor) {
    const body = requireObject(input, "records.put")
    const own = body.held_batch !== undefined || body.migrate_legacy === true || (isPlainObject(body.record) && body.record.kind === "proposal" && body.record.type === "team_write")
    if (own) return this.#put(body, actor, null)
    const written = withProvenance(body.record?.stated_by, await this.#keyed("records.put", body, actor, (plain, hook) => this.#put(plain, actor, hook)))
    // A meeting page a person saved is what the job runner proposes from (0.11).
    this.#meetingPage(written?.record)
    return written
  }

  #put(body, actor, hook) {
    const done = this.#putInner(body, actor, hook)
    // The index page carries the identities and aliases the lane rule reads, so a
    // write to it makes the cached person stale (review M4).
    if (done?.record?.path === "index") this.#forgetIngestPerson(this.#handleFor(this.#spaceId, false))
    return done
  }

  #putInner(body, actor, hook) {
    const a = normalizeActor(actor)
    if (body.held_batch !== undefined) return this.#putHeldBatch(body.held_batch, a)
    const record = body.record
    if (!isPlainObject(record)) throw invalid("invalid_record", "records.put needs a record object.", 'Send {record: {kind, type, body, …}}; add id and base_version to update.')
    if (record.id !== undefined) {
      requireId(record.id, "record.id")
      const handle = this.#existing(a)
      const current = handle ? this.#load(handle, record.id) : null
      if (!current || !visibleRecord(a, current)) {
        throw notFound(`No record ${record.id} in this space.`, "Leave id out to create a record, or check the id with records.search.")
      }
      if (current.kind === "proposal" && current.type === "team_write") throw forbidden("A held team write can only be changed by review.decide.")
      const done = handle.tx(() => {
        const result = this.#update(handle, a, this.#load(handle, record.id), record, record.base_version)
        hook?.(handle, { ...result, created: false })
        return result
      })
      return { record: pub(done.record), created: false, ...(done.superseded.length ? { superseded: done.superseded } : {}) }
    }
    if (body.upsert_path === true) {
      if (record.kind !== "page" || typeof record.path !== "string") {
        throw invalid("invalid_record", "upsert_path works on pages: send kind page and a path.", "Send {record: {kind: \"page\", path, …}, upsert_path: true}.")
      }
      checkPath(record.path)
      const handle = this.#existing(a)
      const current = handle ? this.#loadByPath(handle, record.path) : null
      if (current) {
        if (!canRead(a, current.path)) {
          throw forbidden(`You have no grant covering ${record.path}.`, "Ask the page's owner for an editor grant.")
        }
        const done = handle.tx(() => {
          const result = this.#update(handle, a, this.#loadByPath(handle, record.path), record, record.base_version)
          hook?.(handle, { ...result, created: false })
          return result
        })
        return { record: pub(done.record), created: false, ...(done.superseded.length ? { superseded: done.superseded } : {}) }
      }
    }
    const fresh = markJournal(newRecord(record, a, this.#nowIso(), this.#settings.proposalTtlDays), a)
    if (body.migrate_legacy === true && (fresh.kind !== "commitment" || fresh.fields.migrated_from !== "hub" || typeof fresh.fields.legacy_id !== "string" || !/^cmt_[A-Za-z0-9_-]{1,100}$/.test(fresh.fields.legacy_id))) {
      throw invalid("invalid_request", "A legacy migration needs a commitment with a valid hub legacy_id.", "Send the original commitment id and migrated_from: hub.")
    }
    if (fresh.kind === "proposal" && fresh.type === "team_write") {
      if (a.spaceKind !== "personal" || fresh.status !== "proposed") throw invalid("invalid_record", "A held team write must be proposed in the author's personal space.", "Create it in your personal space.")
      if (!SPACE_ID.test(String(fresh.fields.space_id ?? "")) || fresh.fields.space_id === this.#spaceId || typeof fresh.fields.space_name !== "string" || !fresh.fields.space_name.trim()) throw invalid("invalid_record", "The proposal must name its target shared space.", "Send the target space id and display name from control.")
      if (typeof body.idempotency_key !== "string" || fresh.fields.key !== body.idempotency_key) throw invalid("invalid_record", "A held write needs its idempotency key.", "Send the same key in fields.key and idempotency_key.")
      const payload = parse(fresh.body, null)
      if (!Array.isArray(payload?.records) || payload.records.length < 1 || payload.records.length > 20) throw invalid("invalid_record", "A held write needs one to twenty records.", "Send the proposed records.")
      fresh.fields.preview = heldPreview(payload.records[0]?.body)
      fresh.fields.record_count = payload.records.length
      for (const item of payload.records) {
        if (!isPlainObject(item) || !["memory", "page"].includes(item.kind)) throw invalid("invalid_record", "A held write may contain only memories or pages.", "Send valid records.")
        if (item.kind === "page" && (isInstructionShaped(item.body) || isInstructionShaped(item.title))) throw refused("Not written: the page contains an instruction.", "Remove the instruction before writing the page.")
        const { id: _id, base_version: _version, ...create } = item
        this.#checkCreate(a, newRecord(create, a, this.#nowIso(), this.#settings.proposalTtlDays))
      }
    }
    // A `link` proposal writes a page field, and a `merge` adds an identity, so
    // they are the service's own writes: no client, agent or bearer can create
    // one (J4 review, finding 5). Only the job runner writes `link`; the
    // routines still write `merge` for their own day.
    if (fresh.kind === "proposal" && (fresh.type === "link" || fresh.type === "merge")) {
      const allowed = fresh.type === "link" ? a.user === JOBS_USER : SYSTEM_USERS.has(a.user)
      if (!allowed) {
        throw Object.assign(forbidden(`A ${fresh.type} proposal is written by the service, not by a client.`, "Ask for the change in Memory's console, or let the job or routine propose it."), { code: "proposal_reserved" })
      }
    }
    this.#checkCreate(a, fresh)
    const handle = this.#writer(a)
    if (fresh.type === "team_write" && (a.role !== "owner" || handle.meta?.owner_user !== a.user || !this.#settings.heldReceiptKey)) throw forbidden("Held writes need the caller's own personal space and a configured receipt key.")
    const key = body.idempotency_key
    if (key !== undefined && (typeof key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(key))) throw invalid("invalid_request", "idempotency_key is invalid.", "Send 16 to 128 letters, digits, underscores or hyphens.")
    const digest = key ? sha256(JSON.stringify({ record, upsert_path: body.upsert_path === true })) : null
    const done = handle.tx(() => {
      if (body.migrate_legacy === true) {
        const legacy = fresh.fields.legacy_id
        const prior = handle.get("select record_id from legacy_commitments where legacy_id = ?", legacy)
        if (prior) {
          const existing = this.#load(handle, prior.record_id)
          if (existing && !visibleRecord(a, existing)) throw forbidden("The migrated commitment is not visible to this caller.")
          return { record: existing, superseded: [], replayed: true, legacy: true }
        }
        const existing = handle.all("select id from records where kind = 'commitment' and json_extract(fields, '$.legacy_id') = ?", legacy)
        if (existing.length > 1) throw conflict("conflict", `More than one commitment has legacy id ${legacy}.`, "Resolve the duplicates before migrating this item.")
        if (existing.length === 1) {
          const found = this.#load(handle, existing[0].id)
          if (!visibleRecord(a, found)) throw forbidden("The migrated commitment is not visible to this caller.")
          handle.run("insert into legacy_commitments (legacy_id, record_id) values (?, ?)", legacy, found.id)
          return { record: found, superseded: [], replayed: true, legacy: true }
        }
        const result = this.#create(handle, a, fresh, this.#change(a, "create"))
        handle.run("insert into legacy_commitments (legacy_id, record_id) values (?, ?)", legacy, result.record.id)
        return result
      }
      if (key) {
        const prior = handle.get("select digest, record_id from idempotent_writes where user_id = ? and key = ?", a.user, key)
        if (prior) {
          if (prior.digest !== digest) throw conflict("idempotency_conflict", "This key was used for a different write.", "Use a new key for a new write.")
          const existing = this.#load(handle, prior.record_id)
          if (!existing || !canRead(a, existing.path)) throw conflict("idempotency_gone", "The earlier write is no longer available.", "Do not repeat it with a new key.")
          return { record: existing, superseded: [], replayed: true }
        }
      }
      if (SYSTEM_USERS.has(a.user) && fresh.kind !== "page") {
        // A routine or a job never re-creates what a person forgot (FABLE records #2).
        const why = this.#routineBlock(handle, { key: fresh.fields?.routine_key ?? fresh.fields?.job_key, refs: [fresh.source?.turn, fresh.source?.event], texts: [fresh.title ?? "", fresh.body ?? ""] })
        if (why) throw conflict("forgotten", `Not written: a person forgot this (${why}).`, "Skip the item; never retry it.")
      } else if (SYSTEM_USERS.has(a.user) && typeof (fresh.fields?.routine_key ?? fresh.fields?.job_key) === "string" && handle.get("select 1 as hit from routine_tombstones where key = ?", `key:${fresh.fields?.routine_key ?? fresh.fields?.job_key}`)) {
        throw conflict("forgotten", "Not written: a person deleted this page.", "Skip the item; never retry it.")
      }
      const result = this.#create(handle, a, fresh, this.#change(a, "create", provenanceNote(fresh.fields)))
      if (key) handle.run("insert into idempotent_writes (user_id, key, digest, record_id) values (?, ?, ?, ?)", a.user, key, digest, result.record.id)
      hook?.(handle, { ...result, created: true })
      return result
    })
    return { record: done.record ? pub(done.record) : null, created: !done.replayed, ...(body.migrate_legacy === true ? { legacy_migration: true } : {}), ...(done.replayed ? { replayed: true } : {}), ...(done.legacy && !done.record ? { deleted: true } : {}), ...(done.superseded.length ? { superseded: done.superseded } : {}) }
  }

  /** Apply a batch only once in the shared cell and sign its immutable result. */
  #putHeldBatch(input, actor) {
    if (actor.spaceKind !== "shared" || !this.#settings.heldReceiptKey) throw forbidden("Held acceptance needs a shared space and a configured receipt key.")
    requireRole(actor, "editor", "Accepting a held write needs a write role")
    if (!isPlainObject(input) || typeof input.key !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(input.key) || !Array.isArray(input.records) || input.records.length < 1 || input.records.length > 20) throw invalid("invalid_request", "Invalid held batch.", "Send its key and one to twenty records.")
    const digest = sha256(JSON.stringify(input.records))
    const receipt = signHeldReceipt(this.#settings.heldReceiptKey, { v: 1, user: actor.user, space: this.#spaceId, key: input.key, digest })
    const handle = this.#writer(actor)
    return handle.tx(() => {
      const prior = handle.get("select digest, receipt from held_batches where user_id = ? and key = ?", actor.user, input.key)
      if (prior) {
        if (prior.digest !== digest) throw conflict("idempotency_conflict", "This key was used for a different held write.", "Retry with the original content.")
        return { receipt: prior.receipt, replayed: true }
      }
      this.#applyHeldItems(handle, actor, input.records, false)
      handle.run("insert into held_batches (user_id, key, digest, receipt) values (?, ?, ?, ?)", actor.user, input.key, digest, receipt)
      return { receipt, replayed: false, ...heldProvenance(input.records, actor) }
    })
  }

  /**
   * Apply exact held bodies. Personal writes never reuse shared ids or
   * supersession. Provenance follows the caller's credential, as for any
   * write (mayStatePerson): the console's accept, a browser session, keeps a
   * `person` the batch carries; a bearer's batch (the Jelly Inbox view, or any
   * editor token) is applied with it stored as `agent`.
   */
  #applyHeldItems(handle, actor, records, personal) {
    for (const original of records) {
      if (!isPlainObject(original) || !["memory", "page"].includes(original.kind)) throw invalid("invalid_record", "Invalid held record.", "Send memories or pages.")
      if (original.kind === "page" && (isInstructionShaped(original.body) || isInstructionShaped(original.title))) throw refused("Not written: the page contains an instruction.", "Remove the instruction before writing the page.")
      const { id, base_version: version, supersedes, ...rest } = original
      const item = personal ? rest : original
      if (!personal && id) {
        const current = this.#load(handle, requireId(id))
        if (!current || current.kind !== "page" || original.kind !== "page" || !canRead(actor, current.path)) throw notFound("The target page no longer exists.", "Read the page and propose it again.")
        this.#update(handle, actor, current, item, version)
      } else {
        const fresh = markJournal(newRecord(item, actor, this.#nowIso(), this.#settings.proposalTtlDays), actor)
        this.#checkCreate(actor, fresh)
        this.#create(handle, actor, fresh, this.#change(actor, "create"))
      }
    }
  }

  /** records.get: `{ids?, paths?}` (≤ 50 together) → `{records, missing}`. */
  async get(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "records.get")
    const ids = body.ids ?? []
    const paths = body.paths ?? []
    if (!Array.isArray(ids) || !Array.isArray(paths) || ids.some((id) => typeof id !== "string") || paths.some((p) => typeof p !== "string")) {
      throw invalid("invalid_request", "ids and paths must be lists of strings.", 'Send {ids: ["rec_…"]} or {paths: ["projects/harbour"]}.')
    }
    if (ids.length + paths.length === 0) throw invalid("invalid_request", "Name at least one id or path.", 'Send {ids: ["rec_…"]} or {paths: ["projects/harbour"]}.')
    if (ids.length + paths.length > 50) throw invalid("invalid_request", "At most 50 ids and paths together.", "Ask in batches of 50.")
    const handle = this.#reader()
    const records = []
    const missing = []
    for (const id of ids) {
      const record = RECORD_ID.test(id) ? this.#load(handle, id) : null
      if (record && visibleRecord(a, record)) records.push(pub(record))
      else missing.push(id)
    }
    for (const p of paths) {
      const normal = normalizeTarget(p)
      const record = normal && !RECORD_ID.test(normal) ? this.#loadByPath(handle, normal) : null
      if (record && canRead(a, record.path)) records.push(pub(record))
      else missing.push(p)
    }
    return { records, missing }
  }

  /** records.list: newest first, bodies cut to 500 characters unless `full`. */
  async list(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "records.list")
    const kinds = stringList(body.kind, "kind", Object.keys(KINDS))
    const types = stringList(body.type, "type", [...new Set(Object.values(KINDS).flat())])
    const statuses = statusFilter(body.status, kinds)
    const prefix = checkPrefix(body.path_prefix)
    const limit = intInRange(body.limit, "limit", 1, 200, 50)
    const cursor = decodeCursor(body.cursor, 2)
    const where = ["(kind <> 'proposal' or type <> 'team_write' or author_user = ?)"]
    const params = [a.user]
    if (kinds) {
      where.push(`kind in (${placeholders(kinds.length)})`)
      params.push(...kinds)
    }
    if (types) {
      where.push(`type in (${placeholders(types.length)})`)
      params.push(...types)
    }
    if (statuses) {
      where.push(`status in (${placeholders(statuses.length)})`)
      params.push(...statuses)
    }
    if (prefix) {
      const clause = prefixClause(prefix)
      where.push(clause.sql)
      params.push(...clause.params)
    }
    selectionClauses(body, where, params)
    const vis = visibilityClause(a)
    if (vis) {
      where.push(vis.sql)
      params.push(...vis.params)
    }
    if (cursor) {
      where.push("(updated < ? or (updated = ? and id < ?))")
      params.push(cursor[0], cursor[0], cursor[1])
    }
    const handle = this.#reader()
    const rows = handle.all(
      `select * from records ${where.length ? `where ${where.join(" and ")}` : ""} order by updated desc, id desc limit ?`,
      ...params,
      limit + 1,
    )
    const more = rows.length > limit
    const page = rows.slice(0, limit).map(fromRow)
    const last = page.at(-1)
    return {
      records: page.map((record) => listed(record, body.full === true)),
      cursor: more && last ? encodeCursor([last.updated, last.id]) : null,
      filters: [...SELECTION_FILTERS],
    }
  }

  /**
   * records.search: FTS5 (porter) over title, body, path, aliases and tags.
   * The match runs first, ranked by bm25, and the filters after it; when the
   * filters leave too few hits the match window widens.
   */
  async search(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "records.search")
    if (typeof body.query !== "string" || !body.query.trim()) {
      throw invalid("invalid_query", "records.search needs a query.", "Send {query: \"words to look for\"}.")
    }
    // Only the first 16 words count, so a long query is cut rather than refused.
    const { all, any, words } = ftsQuery(body.query.slice(0, 1000))
    if (!all) throw invalid("invalid_query", "The query has no words to search for.", "Send words or numbers, not only punctuation.")
    const limit = intInRange(body.limit, "limit", 1, 50, 10)
    const kinds = stringList(body.kinds, "kinds", Object.keys(KINDS))
    const types = stringList(body.types, "types", [...new Set(Object.values(KINDS).flat())])
    if (body.status !== undefined && body.status !== "current" && body.status !== "all") {
      throw invalid("invalid_request", 'status is "current" or "all".', 'Send "all" to include superseded, retired and proposed records.')
    }
    const statuses = body.status === "all" ? null : DEFAULT_STATUSES
    const prefix = checkPrefix(body.path_prefix)
    // A search pages by rank: the cursor holds how many hits came before.
    const at = decodeCursor(body.cursor, 2)
    const offset = at ? Number(at[1]) : 0
    if (at && (at[0] !== "search" || !Number.isInteger(offset) || offset < 1 || offset + limit > SEARCH_DEPTH)) {
      if (at[0] === "search" && Number.isInteger(offset) && offset + limit > SEARCH_DEPTH) {
        throw invalid("invalid_cursor", `A search pages through its first ${SEARCH_DEPTH} hits.`, "Narrow the query or the filters, or list with records.list, which pages without a limit.")
      }
      throw invalid("invalid_cursor", "The cursor is not one this service gave out.", "Send the cursor from the previous answer unchanged, or leave it out to start from the beginning.")
    }
    const total = offset + limit + 1
    const where = ["rid in (select value from json_each(?))", "(kind <> 'proposal' or type <> 'team_write' or author_user = ?)"]
    const params = [a.user]
    selectionClauses(body, where, params)
    if (kinds) {
      where.push(`kind in (${placeholders(kinds.length)})`)
      params.push(...kinds)
    }
    if (types) {
      where.push(`type in (${placeholders(types.length)})`)
      params.push(...types)
    }
    if (statuses) {
      where.push(`status in (${placeholders(statuses.length)})`)
      params.push(...statuses)
    }
    if (prefix) {
      const clause = prefixClause(prefix)
      where.push(clause.sql)
      params.push(...clause.params)
    }
    const vis = visibilityClause(a)
    if (vis) {
      where.push(vis.sql)
      params.push(...vis.params)
    }
    const handle = this.#reader()
    const match = "select rowid as rid, bm25(records_fts, 4.0, 1.0, 3.0, 3.0) as score from records_fts where records_fts match ? order by score limit ?"
    const filter = `select * from records where ${where.join(" and ")}`
    const scores = new Map()
    const hits = []
    // Every word first, then any word to fill the page. Each pass matches
    // first and filters after, widening its window when the filters leave too
    // few hits.
    for (const query of all === any ? [all] : [all, any]) {
      const want = total - hits.length
      let rows = []
      let pass = new Map()
      for (const window of [Math.max(total * 8, 200), 2000, 20000, -1]) {
        const matched = handle.all(match, query, window)
        pass = new Map(matched.filter((row) => !scores.has(Number(row.rid))).map((row) => [Number(row.rid), Number(row.score)]))
        rows = pass.size ? handle.all(filter, JSON.stringify([...pass.keys()]), ...params) : []
        if (rows.length >= want || window === -1 || matched.length < window) break
      }
      rows.sort((x, y) => pass.get(Number(x.rid)) - pass.get(Number(y.rid)) || (x.updated === y.updated ? Number(x.rid) - Number(y.rid) : x.updated < y.updated ? 1 : -1))
      for (const row of rows.slice(0, want)) {
        scores.set(Number(row.rid), pass.get(Number(row.rid)))
        hits.push(row)
      }
      if (hits.length >= total) break
    }
    const more = hits.length > offset + limit
    return {
      filters: [...SELECTION_FILTERS],
      cursor: more ? encodeCursor(["search", String(offset + limit)]) : null,
      hits: hits.slice(offset, offset + limit).map((row) => {
        const record = fromRow(row)
        return {
          id: record.id,
          kind: record.kind,
          type: record.type,
          path: record.path,
          title: record.title,
          status: record.status,
          updated: record.updated,
          score: Number((-scores.get(Number(row.rid))).toPrecision(4)),
          snippet: snippet(record.body || record.title, words, 240),
          links: record.links,
          task: record.task,
        }
      }),
    }
  }

  /** records.revise: correct (a new record that supersedes), confirm, retire, restore, contest. */
  async revise(input, actor) {
    const body = requireObject(input, "records.revise")
    const result =
      body.ids !== undefined
        ? this.#keyed("records.revise", body, actor, (plain, hook) => this.#reviseBatch(plain, actor, hook))
        : this.#keyed("records.revise", body, actor, (plain, hook) => this.#revise(plain, actor, hook))
    if (body.action === "forget" || body.action === "forget_versions") return { ...result, erase: this.#eraseFile() }
    return body.action === "correct" ? withProvenance(body.stated_by, result) : result
  }

  /** A revise's reason: at most 2000 characters of text, or none. */
  #reviseReason(body) {
    if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 2000)) {
      throw invalid("invalid_request", "reason must be text of at most 2000 characters.", "Shorten the reason.")
    }
    return body.reason || undefined
  }

  /** Who may revise a record: the checks a single revise and each item of a batch run before any change. */
  #reviseAccess(a, current, id, meta, action) {
    if (!current || !visibleRecord(a, current)) throw notFound(`No record ${id} in this space.`, "Check the id with records.search (status: \"all\" includes superseded records).")
    if (!canWrite(a, current.path)) throw forbidden("You can read this record but not change it.")
    // correct is refused for every page further on (invalid_action).
    if (current.kind === "page" && action !== "correct" && bearerOnTeamPage(a, meta)) throw pageLinesKept(`${id} is a page in a shared space; an agent does not revise it.`, "Add lines with records.append. The person retires, restores or forgets a team page in Memory's console.")
    if (current.kind === "proposal") {
      throw invalid("invalid_action", "A proposal is answered with review.decide, not revised.", `Call review.decide with {id: "${id}", decision: "accept" | "reject" | "edit"}.`)
    }
  }

  /** Whether `action` applies to the record's state now (inside the write's transaction). */
  #reviseState(fresh, id, action) {
    if (fresh.superseded_by || fresh.status === "superseded") {
      throw conflict("conflict", `${id} is superseded${fresh.superseded_by ? ` by ${fresh.superseded_by}` : ""}.`, "Revise the current successor instead; superseded records cannot be reactivated.")
    }
    const allowed = {
      current: ["correct", "confirm", "retire", "contest"],
      contested: ["correct", "confirm", "retire", "contest"],
      retired: ["restore"],
    }
    if (!allowed[fresh.status]?.includes(action)) {
      throw conflict("conflict", `Cannot ${action} a ${fresh.status} record.`, "Restore a retired record before revising it; use records.history to inspect its lineage.")
    }
  }

  /** confirm, retire, restore or contest: a new version of the same record. */
  #reviseStatus(handle, a, fresh, action, reason) {
    const next = { ...fresh, fields: { ...fresh.fields } }
    if (action === "confirm") {
      next.fields.confirmed_at = this.#nowIso()
      if (next.status === "contested") next.status = "current"
      delete next.fields.contested_reason
    } else if (action === "retire") {
      next.status = "retired"
      this.#auditDelete(handle, a, fresh, "retire")
    } else if (action === "restore") {
      next.status = "current"
      delete next.fields.contested_reason
    } else if (action === "contest") {
      next.status = "contested"
      if (reason) next.fields.contested_reason = reason
    }
    return this.#save(handle, fresh, markJournal(next, a), this.#change(a, action, reason ? { reason } : {}))
  }

  /**
   * Who may hard-delete a record: records.delete, a batch forget, its lineage
   * and forget_versions all ask here. Own records need editor; others' and
   * pages admin or owner. In a shared space (SEC-0912) a bearer never deletes
   * a page or another person's record, whatever its role: only the person in
   * a browser session of the console, or the routines, do.
   */
  #deleteAccess(a, record, id, meta, { named = false } = {}) {
    if (!record || !visibleRecord(a, record)) throw notFound(`No record ${id} in this space.`, "Check the id with records.search (status: \"all\" includes superseded records).")
    if (record.kind === "proposal" && record.type === "team_write" && record.status === "accepting") throw conflict("conflict", "An acceptance is still being completed.", "Complete the acceptance before deleting its proposal.")
    // records.delete names the record in its refusals (`named`); a revise does not.
    if (record.kind === "page") {
      if (!hasRole(a, "admin")) throw named ? forbidden(`Deleting a page (${record.path}) needs the admin or owner role.`, "Ask an admin of this space to delete it, or retire it with records.revise.") : forbidden("Deleting a page needs the admin or owner role.", "Ask an admin of this space to delete it, or retire it.")
      if (bearerOnTeamPage(a, meta)) throw teamDeleteConsoleOnly(`${record.path} is a team page; a key or an agent does not delete it.`, "Retire it with records.revise, or the person deletes it in Memory's console, signed in in a browser.")
    } else if (record.owner === a.user) {
      if (!canWrite(a, record.path)) throw forbidden(named ? `Deleting ${id} needs the editor role.` : "Deleting this record needs the editor role.")
    } else if (!hasRole(a, "admin")) {
      throw named ? forbidden(`${id} belongs to someone else; deleting it needs the admin or owner role.`, "Ask its owner or an admin to delete it, or retire it with records.revise.") : forbidden("This record belongs to someone else; deleting it needs the admin or owner role.", "Ask its owner or an admin to delete it, or retire it.")
    } else if (bearerOnTeamPage(a, meta)) {
      throw teamDeleteConsoleOnly(`${id} belongs to someone else in a shared space; a key or an agent does not delete it.`, "Ask its owner to delete it, or the person deletes it in Memory's console, signed in in a browser.")
    }
  }

  /**
   * records.revise `{ids, action, reason?}`: one action on up to MAX_BATCH
   * records in one transaction. Each id is checked as a single revise (or, for
   * forget, a records.delete) checks it; one that fails is reported in its
   * result and the others still apply. The answer and its receipt carry ids,
   * statuses, versions and error codes, never content.
   */
  #reviseBatch(body, actor, hook) {
    const a = normalizeActor(actor)
    if (body.id !== undefined) throw invalid("invalid_request", "Send id for one record or ids for several, not both.", "Put every id in ids.")
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > MAX_BATCH) {
      throw invalid("invalid_request", `ids must list 1 to ${MAX_BATCH} record ids.`, `Send {ids: ["rec_…"], action}; split a longer list into calls of ${MAX_BATCH}.`)
    }
    for (const id of body.ids) requireId(id, "each id")
    if (!BATCH_ACTIONS.includes(body.action)) {
      throw invalid("invalid_action", `"${body.action}" is not a batch revise action.`, `Send action as one of ${BATCH_ACTIONS.join(", ")}; correct takes one id and its text.`)
    }
    const reason = this.#reviseReason(body)
    // records.delete is not open to a page grant (the gateway's GRANT_METHODS),
    // so a batch forget is not either.
    if (body.action === "forget" && !hasRole(a, "editor")) throw forbidden("Forgetting records needs the editor role in this space.", "Retire them instead, or ask an editor of this space.")
    const ids = [...new Set(body.ids)]
    const outcome = (id, error) => ({ id, ok: false, error: { code: error.code, message: error.message } })
    const handle = this.#existing(a)
    if (!handle) {
      const results = ids.map((id) => outcome(id, notFound(`No record ${id} in this space.`, "Check the id.")))
      return { action: body.action, results, done: 0, failed: results.length }
    }
    return handle.tx(() => {
      const results = []
      let linksRemoved = 0
      // A forget erases each record, every predecessor along its supersession
      // lineage the caller may delete, and their versions; what it erased
      // becomes one purge entry for the caller's outbox (docs/design/forget-erase.md).
      const erased = new Set()
      const sentences = []
      for (const id of ids) {
        try {
          if (body.action === "forget" && erased.has(id)) {
            results.push({ id, ok: true, deleted: true, predecessors: [], left: [] })
            continue
          }
          const current = this.#load(handle, id)
          if (body.action === "forget") {
            try {
              this.#deleteAccess(a, current, id, handle?.meta)
            } catch (error) {
              // A team page keeps FIX-0911's answer for a batch revise.
              if (error?.code === "team_delete_console_only" && current?.kind === "page") throw pageLinesKept(`${id} is a page in a shared space; an agent does not revise it.`, "The person forgets a team page in Memory's console.")
              throw error
            }
            const { predecessors, left } = this.#lineage(handle, a, id, erased)
            for (const record of [current, ...predecessors]) {
              sentences.push(...this.#erasedSentences(handle, record))
              this.#auditDelete(handle, a, record, "forget")
              this.#tombstone(handle, record)
              linksRemoved += this.#hardDelete(handle, record.id)
              erased.add(record.id)
            }
            results.push({ id, ok: true, deleted: true, predecessors: predecessors.map((record) => record.id), left })
            continue
          }
          this.#reviseAccess(a, current, id, handle?.meta, body.action)
          this.#reviseState(current, id, body.action)
          const saved = this.#reviseStatus(handle, a, current, body.action, reason)
          results.push({ id, ok: true, status: saved.status, version: saved.version })
        } catch (error) {
          if (!(error instanceof RecordsError)) throw error
          results.push(outcome(id, error))
        }
      }
      const done = results.filter((item) => item.ok).length
      const purgeId = body.action === "forget" ? this.#writePurge(handle, a.user, sentences) : null
      const result = {
        action: body.action,
        results,
        done,
        failed: results.length - done,
        ...(body.action === "forget" ? { links_removed: linksRemoved } : {}),
        ...(purgeId ? { purge_id: purgeId } : {}),
      }
      hook?.(handle, result)
      return result
    })
  }

  #revise(body, actor, hook) {
    const a = normalizeActor(actor)
    const id = requireId(body.id)
    if (!REVISE_ACTIONS.includes(body.action)) {
      throw invalid("invalid_action", `"${body.action}" is not a revise action.`, `Send action as one of ${REVISE_ACTIONS.join(", ")}.`)
    }
    if (body.action === "forget_versions") return this.#forgetVersions(body, a, hook)
    const reason = this.#reviseReason(body)
    const handle = this.#existing(a)
    const current = handle ? this.#load(handle, id) : null
    this.#reviseAccess(a, current, id, handle?.meta, body.action)
    return handle.tx(() => {
      const fresh = this.#load(handle, id)
      this.#reviseState(fresh, id, body.action)
      if (body.action === "correct") {
        if (fresh.kind === "page") {
          throw invalid("invalid_action", "A page is corrected in place, keeping its path; its history keeps the old text.", `Send records.put {record: {id: "${id}", base_version: ${fresh.version}, body}}.`)
        }
        if (body.body === undefined && body.title === undefined) {
          throw invalid("invalid_request", "correct needs the corrected text.", "Send body (and title, if it changed).")
        }
        if (fresh.status === "superseded") {
          throw conflict("conflict", `${id} is already superseded by ${fresh.superseded_by}.`, `Correct ${fresh.superseded_by} instead.`)
        }
        const { confirmed_at: _confirmed, contested_reason: _contested, ...fields } = fresh.fields
        const replacement = newRecord(
          {
            kind: fresh.kind,
            type: fresh.type,
            title: body.title ?? (body.body === undefined ? fresh.title : undefined),
            body: body.body ?? fresh.body,
            fields: fresh.kind === "commitment" && body.title !== undefined ? { ...fields, what: body.title } : fields,
            stated_by: body.stated_by,
            task: fresh.task ?? undefined,
            owner: fresh.owner ?? undefined,
            supersedes: [id],
          },
          a,
          this.#nowIso(),
          this.#settings.proposalTtlDays,
        )
        curate(replacement, a)
        const done = this.#create(handle, a, replacement, this.#change(a, "correct", reason ? { reason } : {}))
        const result = { record: pub(done.record), superseded: pub(this.#load(handle, id)) }
        hook?.(handle, result)
        return result
      }
      const saved = this.#reviseStatus(handle, a, fresh, body.action, reason)
      const result = { record: pub(saved) }
      hook?.(handle, result)
      return result
    })
  }

  /** records.append: add a line to a `## section` of a page, creating the section. */
  async append(input, actor) {
    const body = requireObject(input, "records.append")
    return this.#keyed("records.append", body, actor, (plain, hook) => this.#append(plain, actor, hook))
  }

  #append(body, actor, hook) {
    const a = normalizeActor(actor)
    const target = checkPath(body.path)
    if (typeof body.section !== "string" || !body.section.trim() || body.section.length > 120 || /\n/.test(body.section)) {
      throw invalid("invalid_request", "section must be a heading of at most 120 characters, on one line.", 'Send the heading\'s text without "##", such as "Timeline".')
    }
    if (typeof body.text !== "string" || !body.text.trim()) throw invalid("invalid_request", "text is empty.", "Send the line to add.")
    if (body.text.length > 8000) throw tooLarge("text is longer than 8000 characters.", "Append a shorter line, or rewrite the page with records.put.")
    const handle = this.#existing(a)
    const current = handle ? this.#loadByPath(handle, target) : null
    if (!current || !canRead(a, current.path)) {
      throw notFound(`No page at ${target}.`, `Create it first with records.put {record: {kind: "page", type, path: "${target}", title, body}}.`)
    }
    if (!canWrite(a, current.path)) throw forbidden(`You can read ${target} but not change it.`)
    // What may be stored (owner decision D3): a routine's line is masked, any other is refused when it holds a secret.
    let line = body.text
    if (a.user === ROUTINE_USER) line = storable(line, "routine").text
    else refuseUnstorable([line], "page")
    if (bearerOnTeamPage(a, handle.meta)) {
      if (JOURNAL_PATH.test(current.path)) throw pageLinesKept(`${target} is a journal page in a shared space; an agent does not write it.`)
      if (restylesTeamPage(body.text)) throw pageLinesKept(`An appended line on the team page ${target} may not hold an HTML comment or tag, a code fence, a heading or a setext underline, or start with a space.`, "Append plain lines.")
    }
    const saved = handle.tx(() => {
      if (a.user === ROUTINE_USER) {
        // A routine timeline line never repeats forgotten text (FABLE records #2).
        const why = this.#routineBlock(handle, { texts: [body.text] })
        if (why) throw conflict("forgotten", `Not written: a person forgot this (${why}).`, "Skip the line; never retry it.")
      }
      const fresh = this.#loadByPath(handle, target)
      const next = markJournal({ ...fresh, body: appendToSection(fresh.body, body.section, line.replace(/\s+$/, "")) }, a)
      const done = this.#save(handle, fresh, next, this.#change(a, "append", { section: body.section.trim() }))
      hook?.(handle, { record: done })
      return done
    })
    this.#meetingPage(saved)
    return { record: pub(saved) }
  }

  /**
   * proposals.create (#58 A9): a page edit proposed at the version its author
   * read, or a new page proposed. It writes a records proposal and nothing
   * else: `review.decide` applies it, so a suggestion never changes a page on
   * its own.
   *
   * Input: `{target_id, base_version, body, title?, note?, wiki?}` for an edit,
   * or `{path, title, body}` for a new page. The proposal's own `path` is left
   * empty (a proposal is not a page); the page it aims at rides in `fields`.
   * `wiki` names the wiki the page belongs to, when the caller knows it: a
   * space holds several wikis and a folder path does not say which
   * (opencode-mem#63, #76).
   */
  async createProposal(input, actor) {
    const body = requireObject(input, "proposals.create")
    return this.#keyed("proposals.create", body, actor, (plain, hook) => this.#createProposal(plain, actor, hook))
  }

  #createProposal(body, actor, hook) {
    const a = normalizeActor(actor)
    const note = optionalText(body.note, "note", 2000)
    // The wiki a proposal names, as its author read it from the knowledge
    // service: an id, never a name that could be guessed at. It rides on the
    // proposal's fields so a read can say where a new page would land.
    const wiki = body.wiki === undefined || body.wiki === null ? null : requireWikiId(body.wiki)
    const id = body.target_id === undefined || body.target_id === null ? null : requireId(body.target_id)
    const path = body.path === undefined || body.path === null ? null : checkPath(body.path)
    // An append proposal adds one line to a section: the only change an agent
    // may propose to a team page (#58 review, finding 4).
    const appending = body.section !== undefined || body.text !== undefined
    if (appending && !id) throw invalid("invalid_request", "An append proposal names the page it adds to.", 'Send {target_id, section, text}.')
    if (appending && (body.section === undefined || body.text === undefined)) throw invalid("invalid_request", "An append proposal needs a section and a line.", 'Send {target_id, section, text}.')
    if (!appending && (typeof body.body !== "string" || !body.body.trim())) throw invalid("invalid_request", "A proposal needs the text it suggests.", 'Send body with the page text the person should see.')
    if (appending && (typeof body.section !== "string" || !body.section.trim() || body.section.length > 120 || /\n/.test(body.section))) {
      throw invalid("invalid_request", "section must be a heading of at most 120 characters, on one line.", 'Send the heading\'s text without "##", such as "Timeline".')
    }
    if (appending && (typeof body.text !== "string" || !body.text.trim() || body.text.length > 8000)) {
      throw invalid("invalid_request", "text must be one line of at most 8000 characters.", "Send the line to add.")
    }
    if (!appending && !id === !path) throw invalid("invalid_request", "Name the page once: target_id to change a page, or path for a new one.", 'Send {target_id, base_version, body} or {path, title, body}.')
    const handle = this.#writer(a)
    const target = id ? this.#load(handle, id) : path ? this.#loadByPath(handle, path) : null
    if (id && (!target || !visibleRecord(a, target))) throw notFound(`No record ${id} in this space.`, "Check the id with records.get.")
    if (target && target.kind !== "page") throw invalid("invalid_record", `A page proposal changes a page; ${id} is a ${target.kind}.`, "Propose an edit to a page.")
    if (target && !canRead(a, target.path)) throw notFound(`No page ${target.path} in this space.`, "Check the path with records.list.")
    // #58 review, finding 4: a team page is append-only for an agent, and a
    // proposal is not a way around it. This is the same refusal path the
    // accept runs (FIX-0914's teamPageLinesRefusal and restylesTeamPage), with
    // the same words, so a proposal that could never be accepted is refused
    // before it is written rather than left waiting.
    if (target && bearerOnTeamPage(a, handle.meta)) {
      if (appending) {
        if (JOURNAL_PATH.test(target.path)) throw pageLinesKept(`${target.path} is a journal page in a shared space; an agent does not write it.`)
        if (restylesTeamPage(body.text)) {
          throw pageLinesKept(
            `An appended line on the team page ${target.path} may not hold an HTML comment or tag, a code fence, a heading or a setext underline, or start with a space.`,
            "Append plain lines.",
          )
        }
      } else {
        const next = updatedRecord(target, { body: body.body, ...(typeof body.title === "string" && body.title.trim() ? { title: body.title } : {}) }, a, this.#nowIso())
        const refusal = teamPageLinesRefusal(target, next)
        if (refusal) throw refusal
      }
    }
    // The version the proposer read: a page that moved since is a new proposal,
    // not a silent overwrite of someone else's edit.
    if (target && body.base_version !== undefined && body.base_version !== null) {
      if (!Number.isInteger(body.base_version)) throw invalid("invalid_record", "base_version must be a whole number.", "Send the version you read.")
      if (body.base_version !== target.version) {
        throw conflict("version_conflict", `${target.path} is at version ${target.version}, not ${body.base_version}.`, `Read the page again and propose against version ${target.version}.`, { current: pub(target) })
      }
    }
    // A proposal is text the person will read: it is refused for a secret or a
    // person's email exactly as a direct write is (#58 review, finding 6).
    refuseUnstorable(appending ? [body.section, body.text, note] : [body.body, body.title, note], "page")
    const title = optionalText(body.title, "title", 300)
    const baseVersion = Number.isInteger(body.base_version) ? body.base_version : (target?.version ?? null)
    const record = appending
      ? {
          kind: "proposal",
          type: "append",
          // An append carries no version: it merges beside whatever landed
          // first, and its guard is the section it adds to (#58 review). A
          // section that was not there when it was proposed is the append's own
          // to create, as records.append does.
          fields: {
            target_id: target.id,
            target_path: target.path,
            ...(wiki ? { wiki } : {}),
            payload: { section: body.section.trim(), text: body.text.replace(/\s+$/, "") },
            section_existed: hasSection(target.body, body.section),
            ...(note ? { note } : {}),
          },
        }
      : target
        ? {
            kind: "proposal",
            type: "supersede",
            stated_by: actor?.user ? undefined : "agent",
            fields: { target_id: target.id, target_path: target.path, ...(wiki ? { wiki } : {}), payload: { ...(title ? { title } : {}), body: body.body }, ...(baseVersion ? { base_version: baseVersion } : {}), ...(note ? { note } : {}) },
          }
        : {
            kind: "proposal",
            type: "create",
            fields: { target_path: path, ...(wiki ? { wiki } : {}), payload: { kind: "page", type: pageTypeForPath(path), ...(title ? { title } : {}), path, body: body.body }, ...(note ? { note } : {}) },
          }
    return handle.tx(() => {
      const fresh = newRecord(record, a, this.#nowIso(), this.#settings.proposalTtlDays)
      const done = this.#create(handle, a, fresh, this.#change(a, "propose", { ...(target ? { target: target.id } : {}), ...(note ? { note } : {}) }))
      const result = { proposal: pub(done.record), ...(target ? { target: { id: target.id, path: target.path, version: target.version } } : {}) }
      hook?.(handle, result)
      return result
    })
  }

  /**
   * proposals.askChanges (#58 A9): a reader's note on an open proposal. The
   * proposal stays `proposed`: it records what is wanted, not a decision. A
   * note is data, never an instruction to the agent that reads it.
   */
  async askProposalChanges(input, actor) {
    const body = requireObject(input, "proposals.askChanges")
    return this.#keyed("proposals.askChanges", body, actor, (plain, hook) => this.#askProposalChanges(plain, actor, hook))
  }

  #askProposalChanges(body, actor, hook) {
    const a = normalizeActor(actor)
    const id = requireId(body.id)
    const note = optionalText(body.note, "note", 2000)
    if (!note) throw invalid("invalid_request", "Ask for the change in a note.", 'Send {id, note: "keep the November date"}.')
    // A note is read by people and agents: no secret, no one's email address.
    refuseUnstorable([note], "page")
    const handle = this.#existing(a)
    const current = handle ? this.#load(handle, id) : null
    if (!current || current.kind !== "proposal" || !visibleRecord(a, current)) throw notFound(`No proposal ${id} in this space.`, "List open proposals with review.list.")
    if (!canRead(a, null)) throw forbidden("You cannot read proposals in this space.")
    if (current.status !== "proposed") throw conflict("conflict", `${id} was already ${current.status}.`, "Ask for changes on an open proposal.")
    return handle.tx(() => {
      const fresh = this.#load(handle, id)
      const comments = Array.isArray(fresh.fields.comments) ? fresh.fields.comments : []
      if (comments.length >= 50) throw invalid("invalid_request", "This proposal holds 50 notes, the most it may.", "Settle it with review.decide.")
      const saved = this.#save(
        handle,
        fresh,
        { ...fresh, fields: { ...fresh.fields, comments: [...comments, { by: a.user, at: this.#nowIso(), kind: "changes_requested", note }], changes_requested_at: this.#nowIso() } },
        this.#change(a, "ask_changes"),
      )
      const result = { proposal: pub(saved) }
      hook?.(handle, result)
      return result
    })
  }

  /** records.move: a page to a new path; links to the old path in other records are rewritten. */
  async move(input, actor) {
    const body = requireObject(input, "records.move")
    return this.#keyed("records.move", body, actor, (plain, hook) => this.#move(plain, actor, hook))
  }

  #move(body, actor, hook) {
    if (body.path_prefix !== undefined || body.to_prefix !== undefined) return this.#movePrefix(body, actor, hook)
    const a = normalizeActor(actor)
    const id = requireId(body.id)
    const to = checkPath(body.path, "new path")
    const handle = this.#existing(a)
    const current = handle ? this.#load(handle, id) : null
    if (!current || !visibleRecord(a, current)) throw notFound(`No record ${id} in this space.`, "Check the id with records.get.")
    if (current.kind !== "page") throw invalid("invalid_record", `Only pages have a path; ${id} is a ${current.kind}.`, "Move a page, or leave this record where it is.")
    if (!canWrite(a, current.path)) throw forbidden(`You can read ${current.path} but not move it.`)
    if (!canWrite(a, to)) throw forbidden(`You cannot write at ${to}.`, "Move the page under a path you have an editor grant on.")
    if (bearerOnTeamPage(a, handle.meta)) throw pageLinesKept(`${current.path} is a team page: an agent does not rename or move it${JOURNAL_PATH.test(to) ? ", and never into journal/" : ""}.`)
    if (to === current.path) return { record: pub(current), rewritten_links: 0, rewritten: [] }
    return handle.tx(() => {
      const taken = handle.get("select id from records where path = ?", to)
      if (taken) throw conflict("path_taken", `A page already lives at ${to} (${taken.id}).`, "Choose another path, or move or delete that page first.", { id: taken.id })
      const fresh = this.#load(handle, id)
      const from = fresh.path
      const selfBody = rewriteBody(fresh.body, from, to)
      const selfLinks = rewriteFieldLinks(fresh.fields?.links, from, to)
      const moved = { ...fresh, path: to, body: selfBody.text, fields: selfLinks ? { ...fresh.fields, links: selfLinks } : fresh.fields }
      const record = this.#save(handle, fresh, markJournal(moved, a), this.#change(a, "move", { from }))
      const sources = handle.all("select distinct src from links where dst = ? and type = 'link' and src <> ?", from, id)
      const rewritten = []
      for (const { src } of sources) {
        const other = this.#load(handle, src)
        if (!other) continue
        if (other.kind === "proposal" && other.type === "team_write") continue
        const { text, count } = rewriteBody(other.body, from, to)
        const fieldLinks = rewriteFieldLinks(other.fields?.links, from, to)
        if (count === 0 && !fieldLinks) continue
        const next = { ...other, body: text, fields: fieldLinks ? { ...other.fields, links: fieldLinks } : other.fields }
        this.#save(handle, other, next, this.#change(a, "link_rewrite", { from, to }))
        rewritten.push(other)
      }
      const result = {
        record: pub(record),
        rewritten_links: rewritten.length,
        rewritten: rewritten.filter((other) => canRead(a, other.path)).map((other) => other.id),
      }
      hook?.(handle, result)
      return result
    })
  }

  /**
   * records.move `{path_prefix, to_prefix}`: every page under a folder to
   * another folder, at most MAX_PREFIX_MOVE pages, in one transaction. Each
   * page keeps its id and versions (a new version notes the move). Links to
   * any moved path, inside the folder and in every other record, are
   * rewritten in one pass. Every target is checked before any write: a
   * target already taken, a path too deep, or a page the caller cannot write
   * refuses the whole move, and the refusal lists each page's problem.
   */
  #movePrefix(body, actor, hook) {
    const a = normalizeActor(actor)
    const folder = (value, what) => {
      if (typeof value !== "string" || !value.endsWith("/") || !PATH.test(value.slice(0, -1))) {
        throw invalid("invalid_path", `${what} must be a folder: a page path ending in "/", such as "projects/old/".`, 'Send {path_prefix: "projects/old/", to_prefix: "projects/new/"}.')
      }
      return value
    }
    const from = folder(body.path_prefix, "path_prefix")
    const to = folder(body.to_prefix, "to_prefix")
    if (from === to) throw invalid("invalid_path", "path_prefix and to_prefix are the same folder.", "Send a different to_prefix.")
    if (to.startsWith(from) || from.startsWith(to)) {
      throw invalid("invalid_path", `${from} and ${to} are nested; a folder cannot move into itself or its parent.`, "Move it to a sibling folder, such as archive/projects/ for projects/.")
    }
    const handle = this.#existing(a)
    const empty = { records: [], moved: [], rewritten_links: 0, rewritten: [], conflicts: [] }
    if (!handle) throw notFound(`No pages under ${from} in this space.`, "Check the folder with records.list {kind: \"page\", path_prefix}.")
    return handle.tx(() => {
      const rows = handle.all("select id from records where kind = 'page' and substr(path, 1, ?) = ? order by path", from.length, from)
      const pages = rows.map((row) => this.#load(handle, row.id)).filter((record) => record && visibleRecord(a, record))
      if (pages.length === 0) throw notFound(`No pages under ${from} in this space.`, "Check the folder with records.list {kind: \"page\", path_prefix}.")
      if (pages.length > MAX_PREFIX_MOVE) throw tooLarge(`${from} holds ${pages.length} pages; one move takes at most ${MAX_PREFIX_MOVE}.`, "Move a smaller folder under it first.")
      if (!pages.some((record) => canWrite(a, record.path))) throw forbidden(`You can read the pages under ${from} but not move them.`)
      if (bearerOnTeamPage(a, handle.meta)) throw pageLinesKept(`The pages under ${from} are team pages: an agent does not rename or move them.`)
      const map = new Map(pages.map((record) => [record.path, `${to}${record.path.slice(from.length)}`]))
      const conflicts = []
      for (const record of pages) {
        const target = map.get(record.path)
        if (!PATH.test(target)) conflicts.push({ id: record.id, path: record.path, to: target, code: "invalid_path", message: "the new path is too deep or too long (at most 4 segments of 64 characters)" })
        else if (!canWrite(a, record.path)) conflicts.push({ id: record.id, path: record.path, to: target, code: "forbidden", message: "you can read this page but not move it" })
        else if (!canWrite(a, target)) conflicts.push({ id: record.id, path: record.path, to: target, code: "forbidden", message: "you cannot write at the new path" })
        else {
          const taken = handle.get("select id from records where path = ?", target)
          if (taken) conflicts.push({ id: record.id, path: record.path, to: target, code: "path_taken", message: `a page already lives at ${target}`, taken: taken.id })
        }
      }
      if (conflicts.length > 0) {
        throw conflict("move_conflicts", `Nothing moved: ${conflicts.length} of ${pages.length} pages under ${from} cannot move to ${to}.`, "Resolve each listed page (move or delete what is in the way, or choose another folder), then move again.", { conflicts })
      }
      const moved = []
      const out = []
      const ids = new Set(pages.map((record) => record.id))
      for (const fresh of pages) {
        const target = map.get(fresh.path)
        const selfBody = rewriteBodyMap(fresh.body, map)
        const selfLinks = rewriteFieldLinksMap(fresh.fields?.links, map)
        const next = { ...fresh, path: target, body: selfBody.text, fields: selfLinks ? { ...fresh.fields, links: selfLinks } : fresh.fields }
        out.push(this.#save(handle, fresh, markJournal(next, a), this.#change(a, "move", { from: fresh.path })))
        moved.push({ id: fresh.id, from: fresh.path, to: target })
      }
      const olds = [...map.keys()]
      const marks = olds.map(() => "?").join(", ")
      const sources = handle.all(`select distinct src from links where type = 'link' and dst in (${marks})`, ...olds)
      const rewritten = []
      for (const { src } of sources) {
        if (ids.has(src)) continue
        const other = this.#load(handle, src)
        if (!other) continue
        if (other.kind === "proposal" && other.type === "team_write") continue
        const { text, count } = rewriteBodyMap(other.body, map)
        const fieldLinks = rewriteFieldLinksMap(other.fields?.links, map)
        if (count === 0 && !fieldLinks) continue
        const next = { ...other, body: text, fields: fieldLinks ? { ...other.fields, links: fieldLinks } : other.fields }
        this.#save(handle, other, next, this.#change(a, "link_rewrite", { from, to }))
        rewritten.push(other)
      }
      const result = {
        ...empty,
        records: out.map(pub),
        moved,
        rewritten_links: rewritten.length,
        rewritten: rewritten.filter((other) => canRead(a, other.path)).map((other) => other.id),
      }
      hook?.(handle, result)
      return result
    })
  }

  /** records.delete: hard delete with versions. Own records need editor; others' admin; pages admin or owner. */
  async delete(input, actor) {
    const body = requireObject(input, "records.delete")
    const result = this.#keyed("records.delete", body, actor, (plain, hook) => this.#delete(plain, actor, hook))
    return { ...result, erase: this.#eraseFile() }
  }

  #delete(body, actor, hook) {
    const a = normalizeActor(actor)
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100) {
      throw invalid("invalid_request", "ids must list 1 to 100 record ids.", 'Send {ids: ["rec_…"]}.')
    }
    for (const id of body.ids) requireId(id, "each id")
    // `purge: true`: a delete that forgets (the console's forget and commitment
    // delete), so the caller's clients purge the text from their spools. A
    // plain delete, such as a move's source, writes no purge entry.
    if (body.purge !== undefined && typeof body.purge !== "boolean") throw invalid("invalid_request", "purge must be true or false.", "Send purge: true when the delete forgets the text.")
    const handle = this.#existing(a)
    if (!handle) return { deleted: [], links_removed: 0, missing: [...body.ids] }
    const meetings = []
    const result = handle.tx(() => {
      const found = []
      const missing = []
      for (const id of new Set(body.ids)) {
        const record = this.#load(handle, id)
        if (!record || !visibleRecord(a, record)) {
          missing.push(id)
          continue
        }
        this.#deleteAccess(a, record, id, handle.meta, { named: true })
        if (record.kind === "page" && record.type === "meeting") meetings.push(record)
        found.push(id)
      }
      let linksRemoved = 0
      const sentences = []
      for (const id of found) {
        const record = this.#load(handle, id)
        if (body.purge === true && (record?.kind === "memory" || record?.kind === "commitment")) sentences.push(...substantiveSentences({ title: record.title, body: record.body, what: record.fields?.what }))
        this.#auditDelete(handle, a, record, body.purge === true ? "forget" : "delete")
        this.#tombstone(handle, record)
        linksRemoved += this.#hardDelete(handle, id)
      }
      const purgeId = body.purge === true ? this.#writePurge(handle, a.user, sentences) : null
      const result = { deleted: found, links_removed: linksRemoved, missing, ...(purgeId ? { purge_id: purgeId } : {}) }
      hook?.(handle, result)
      return result
    })
    // A deleted meeting page takes its proposals' quotes with it (0.11 review).
    for (const meeting of meetings) this.#meetingGone(meeting)
    return result
  }

  /** records.history: every version, newest first, and the supersession lineage both ways. */
  async history(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "records.history")
    const id = requireId(body.id)
    const handle = this.#reader()
    const current = this.#load(handle, id)
    if (!current || !visibleRecord(a, current)) throw notFound(`No record ${id} in this space.`, "Check the id with records.search (status: \"all\").")
    const older = handle
      .all("select snapshot from versions where record_id = ? order by version desc", id)
      .map((row) => parse(row.snapshot, null))
      .filter(Boolean)
    const version = (record) => ({
      version: record.version,
      type: record.type,
      path: record.path,
      title: record.title,
      body: record.body,
      status: record.status,
      stated_by: record.stated_by,
      fields: record.fields,
      supersedes: record.supersedes,
      superseded_by: record.superseded_by,
      source: record.source,
      owner: record.owner,
      updated: record.updated,
      links: record.links,
      change: record.change ?? {},
    })
    const walk = (sql) => {
      const out = []
      const seen = new Set([id])
      let frontier = [id]
      while (frontier.length && out.length < 50) {
        const next = []
        for (const node of frontier) {
          for (const row of handle.all(sql, node)) {
            const other = row.other
            if (seen.has(other)) continue
            seen.add(other)
            const record = this.#load(handle, other)
            if (record && !visibleRecord(a, record)) continue
            out.push(record ? { id: record.id, kind: record.kind, type: record.type, title: record.title, status: record.status, updated: record.updated } : { id: other, missing: true })
            if (record) next.push(other)
          }
        }
        frontier = next
      }
      return out
    }
    return {
      versions: [version(current), ...older.map(version)],
      lineage: {
        supersedes: walk("select dst as other from links where src = ? and type = 'supersedes'"),
        superseded_by: walk("select src as other from links where dst = ? and type = 'supersedes'"),
      },
    }
  }

  /**
   * records.links: the neighbourhood of a record to depth 1 or 2, capped at
   * `max_nodes`. `types` may hold edge types (link, supersedes, source) and
   * record types (person, decision, …); each filters its own side.
   */
  async links(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "records.links")
    const depth = body.depth ?? 1
    if (depth !== 1 && depth !== 2) throw invalid("invalid_request", "depth is 1 or 2.", "Send depth: 1 for direct links, 2 for links of links.")
    const maxNodes = intInRange(body.max_nodes, "max_nodes", 1, 200, 50)
    const allTypes = [...EDGE_TYPES, ...new Set(Object.values(KINDS).flat())]
    const types = stringList(body.types, "types", allTypes, 30)
    const edgeTypes = types?.filter((type) => EDGE_TYPES.has(type))
    const recordTypes = types?.filter((type) => !EDGE_TYPES.has(type))
    const handle = this.#reader()
    let start = null
    if (body.id !== undefined) start = this.#load(handle, requireId(body.id))
    else if (body.path !== undefined) start = this.#loadByPath(handle, checkPath(body.path))
    else throw invalid("invalid_request", "records.links needs an id or a path.", 'Send {path: "people/ama"} or {id: "rec_…"}.')
    if (!start || !visibleRecord(a, start)) throw notFound(`No record ${body.id ?? body.path} in this space.`, "Check it with records.get.")

    const nodes = new Map()
    const edges = new Map()
    const pathToKey = new Map()
    const nodeOf = (record) => ({ id: record.id, path: record.path, title: record.title, kind: record.kind, type: record.type })
    const addRecordNode = (record) => {
      nodes.set(record.id, nodeOf(record))
      if (record.path) pathToKey.set(record.path, record.id)
    }
    const addEdge = (from, to, type) => {
      if (edgeTypes?.length && !edgeTypes.includes(type)) return
      edges.set(`${from}\u0000${to}\u0000${type}`, { from, to, type })
    }
    addRecordNode(start)
    let truncated = false
    let frontier = [start]
    // Resolve one link target to a node: a record, a dangling path, or a
    // source id. Only the node's own columns are read, once per target.
    const light = new Map()
    const lookup = (sql, key) => {
      if (light.has(key)) return light.get(key)
      const row = handle.get(sql, key)
      const record = row && !(row.kind === "proposal" && row.type === "team_write") ? { id: row.id, path: row.path ?? null, title: row.title, kind: row.kind, type: row.type } : null
      light.set(key, record)
      if (record) {
        light.set(record.id, record)
        if (record.path) light.set(record.path, record)
      }
      return record
    }
    const resolve = (dst, type) => {
      if (RECORD_ID.test(dst)) {
        const record = lookup("select id, path, title, kind, type from records where id = ?", dst)
        return record ? { key: record.id, record } : null
      }
      if (type === "source") {
        if (!hasRole(a, "viewer")) return null
        const kind = dst.startsWith("evt_") ? "event" : dst.startsWith("msg") ? "turn" : "source"
        return { key: dst, node: { id: dst, path: null, title: null, kind, type: null } }
      }
      const record = lookup("select id, path, title, kind, type from records where path = ?", dst)
      if (record) return { key: record.id, record }
      if (!canRead(a, dst)) return null
      return { key: dst, node: { id: null, path: dst, title: null, kind: null, type: null, dangling: true } }
    }
    // Each expansion reads at most a few times the remaining budget of edges,
    // so two hops around a node linked from thousands of records stay bounded.
    let unread = false
    for (let level = 1; level <= depth && !truncated; level += 1) {
      const next = []
      for (const record of frontier) {
        if (truncated) break
        const cap = Math.max(maxNodes - nodes.size + 1, 1) * 4
        const outgoing = handle.all("select dst, type from links where src = ? limit ?", record.id, cap)
        const incoming = handle.all("select src, type from links where dst in (?, ?) limit ?", record.id, record.path ?? record.id, cap)
        if (outgoing.length === cap || incoming.length === cap) unread = true
        const candidates = [
          ...outgoing.map((row) => ({ dst: row.dst, type: row.type, out: true })),
          ...incoming.map((row) => ({ dst: row.src, type: row.type, out: false })),
        ]
        for (const candidate of candidates) {
          if (edgeTypes?.length && !edgeTypes.includes(candidate.type)) continue
          const known = nodes.has(candidate.dst) ? candidate.dst : pathToKey.get(candidate.dst)
          if (known) {
            addEdge(candidate.out ? record.id : known, candidate.out ? known : record.id, candidate.type)
            continue
          }
          const found = resolve(candidate.dst, candidate.type)
          if (!found) continue
          if (found.record && !canRead(a, found.record.path)) continue
          const [from, to] = candidate.out ? [record.id, found.key] : [found.key, record.id]
          if (nodes.has(found.key)) {
            addEdge(from, to, candidate.type)
            continue
          }
          if (recordTypes?.length && !(found.record && recordTypes.includes(found.record.type))) continue
          if (nodes.size >= maxNodes) {
            truncated = true
            break
          }
          if (found.record) {
            addRecordNode(found.record)
            next.push(found.record)
          } else {
            nodes.set(found.key, found.node)
          }
          addEdge(from, to, candidate.type)
        }
      }
      frontier = next
    }
    if (unread && depth > 0) truncated = true
    // Edges between nodes that were reached by different routes.
    const recordIds = [...nodes.values()].filter((node) => node.id && RECORD_ID.test(node.id)).map((node) => node.id)
    if (recordIds.length > 1) {
      for (const row of handle.all("select src, dst, type from links where src in (select value from json_each(?))", JSON.stringify(recordIds))) {
        const to = nodes.has(row.dst) ? row.dst : pathToKey.get(row.dst)
        if (to && nodes.has(row.src)) addEdge(row.src, to, row.type)
      }
    }
    return { nodes: [...nodes.values()], edges: [...edges.values()], truncated }
  }

  /** records.backlinks: the records that link to a path (or to the record at it). */
  async backlinks(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "records.backlinks")
    const limit = intInRange(body.limit, "limit", 1, 200, 100)
    const handle = this.#reader()
    let target = null
    let targetPath = null
    if (body.path !== undefined) {
      targetPath = checkPath(body.path)
      target = this.#loadByPath(handle, targetPath)
      if (target ? !canRead(a, target.path) : !canRead(a, targetPath)) throw notFound(`No page at ${targetPath}.`, "Check the path with records.list.")
    } else if (body.id !== undefined) {
      target = this.#load(handle, requireId(body.id))
      if (!target || !visibleRecord(a, target)) throw notFound(`No record ${body.id} in this space.`, "Check the id with records.get.")
      targetPath = target.path
    } else {
      throw invalid("invalid_request", "records.backlinks needs a path.", 'Send {path: "people/ama"}.')
    }
    const keys = [targetPath, target?.id].filter(Boolean)
    const where = [`id in (select src from links where type = 'link' and dst in (${placeholders(keys.length)}))`, "(kind <> 'proposal' or type <> 'team_write' or author_user = ?)"]
    const params = [...keys, a.user]
    const vis = visibilityClause(a)
    if (vis) {
      where.push(vis.sql)
      params.push(...vis.params)
    }
    const rows = handle.all(`select * from records where ${where.join(" and ")} order by updated desc, id desc limit ?`, ...params, limit + 1)
    return {
      records: rows.slice(0, limit).map((row) => listed(fromRow(row), false)),
      truncated: rows.length > limit,
    }
  }

  /** records.export: a gzip tar of Markdown with YAML frontmatter (proposals are left out). */
  async exportTar(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "records.export")
    const prefix = checkPrefix(body.path_prefix)
    const where = ["kind <> 'proposal'"]
    const params = []
    if (prefix) {
      const clause = prefixClause(prefix)
      where.push(clause.sql)
      params.push(...clause.params)
    }
    const vis = visibilityClause(a)
    if (vis) {
      where.push(vis.sql)
      params.push(...vis.params)
    }
    const handle = this.#reader()
    const files = []
    for (const row of handle.all(`select * from records where ${where.join(" and ")} order by kind, path, id`, ...params)) {
      const record = pub(fromRow(row))
      files.push({ name: exportFileName(record), content: toMarkdown(record) })
    }
    return tarGz(files, Math.floor(this.#settings.now().getTime() / 1000))
  }

  // -------------------------------------------------------------------------
  // events.* and sources.*

  #sourceKey(body) {
    const source = body.source
    if (typeof source !== "string" || !isSourceName(source)) {
      throw invalid("invalid_source", "source must be a short lowercase name such as gmail, slack or github.", "Send the source plugin's name.")
    }
    const account = body.account === undefined || body.account === null || body.account === "" ? "default" : body.account
    if (typeof account !== "string" || account.length > 128) throw invalid("invalid_source", "account must be text of at most 128 characters.", 'Send the account alias, or leave it out for "default".')
    return { source, account }
  }

  #owner(owner) {
    if (!isPlainObject(owner) || typeof owner.id !== "string" || !owner.id || owner.id.length > 300) {
      throw invalid("invalid_source", "owner must be {id, label}: whose mailbox or account this is.", "Send the owner the source's events_list returned.")
    }
    const label = owner.label === undefined || owner.label === null ? owner.id : String(owner.label).slice(0, 300)
    return { id: owner.id, label }
  }

  #sourceRow(row, counts, collections, refusals, retractions, kinds = null) {
    const collection = collections?.get(`${row.source}\u0000${row.account}`) ?? null
    const refused = refusals?.get(`${row.source}\u0000${row.account}`) ?? null
    return {
      source: row.source,
      account: row.account,
      owner: { id: row.owner_id, label: row.owner_label },
      status: row.status,
      // **A bound source this release does not collect is marked** (G1, review
      // S4): a snapshot source bound before the rule keeps its row, and the row
      // says nothing is read from it rather than looking healthy.
      kind: kinds?.get(row.source) ?? null,
      // A named-account binding made before the asked account was recorded
      // (review L4-1): Memory cannot say which alias it answered, so it is left
      // collecting and the row says so, with the way out.
      asked_unknown: row.asked_account === null || row.asked_account === undefined ? legacyNamed(row.source) : false,
      collected: kinds?.get(row.source) === null || kinds?.get(row.source) === undefined ? true : kinds.get(row.source) === "events",
      confirmed_at: row.confirmed_at ?? null,
      cursor: row.cursor ?? null,
      cursor_at: row.cursor_at ?? null,
      // What the binding's history is (lane 0195): the window Memory's policy gives it, what it has, and whether it is still waiting.
      history: historyOf(row, collection),
      enabled: Boolean(row.enabled),
      events: counts?.get(`${row.source}\u0000${row.account}`) ?? 0,
      // Removals this binding still has to finish (0.11 review R6-S2): a quiet
      // read says how much unretracted text is still reachable.
      retractions: { pending: Number(retractions?.get(`${row.source}\u0000${row.account}`)) || 0 },
      // The collector's last report for this binding (sources.collected), or null.
      // A row a build before 0.10.4's gate wrote holds the collector's own words
      // raw: redacted where it is answered, so Sources and Home cannot show a
      // secret from an old database (0.11 review, round 2).
      collection: this.#collectionRow(collection),
      // Every event this source refused, and the newest one: the contract's
      // policy moves the cursor past `refused[]`, so this is where that loss is
      // seen rather than trusted away.
      refusals: {
        count: Number(refused?.count) || 0,
        at: refused?.at ?? null,
        newest_id: refused?.external_id ?? null,
        kind: refused?.kind ?? null,
        reason: refused?.reason ?? null,
      },
    }
  }

  #normalizeEvent(event, own) {
    return normalizeEvent(event, own)
  }

  /**
   * A person's own personal space: where a session's ownership is recorded,
   * whatever space the capture or the events arrived in (DESIGN §15.1, B8).
   * Ownership is per person, never per active space, so a session captured
   * while a shared space is active is still the person's own.
   */
  #personalSpaceOf(user) {
    if (typeof user !== "string" || user === "" || user === ROUTINE_USER || user === JOBS_USER) return null
    return this.#personalSpaceFor(user, this.#spaceId)
  }

  /** The handle and id of the person's personal space; null when there is none. */
  #ownership(a) {
    const spaceId = this.#personalSpaceOf(a.user)
    if (!spaceId) return null
    const handle = this.#handleFor(spaceId, false)
    return handle ? { spaceId, handle } : null
  }

  /**
   * The session's row, History's side: the first pipeline to see a session owns
   * its curation, and the row records that once, in the person's own space.
   */
  #sessionSeenHistory(own, session, eventId, nowIso) {
    if (!own) return
    own.handle.run(
      "insert into sessions_seen (session_id, first_side, first_event_id, at, updated) values (?, 'history', ?, ?, ?) on conflict(session_id) do update set updated = excluded.updated",
      session,
      eventId,
      nowIso,
      nowIso,
    )
  }

  /**
   * The owner of each session, as the routine's curate stage reads it: the
   * first side to see a session owns its curation (DESIGN §15.1, B8). Read-only
   * and in this space, where the person's own rows are; no HTTP route.
   */
  async sessionsOwner(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reading a session's owner needs a role in this space")
    const body = requireObject(input, "sessions.owner")
    const ids = Array.isArray(body.session_ids) ? body.session_ids.filter((id) => typeof id === "string" && id !== "" && id.length <= 300).slice(0, 500) : []
    const owners = {}
    if (ids.length === 0) return { owners }
    const rows = this.#reader().all(`select session_id, first_side from sessions_seen where session_id in (${ids.map(() => "?").join(", ")})`, ...ids)
    for (const row of rows) owners[row.session_id] = row.first_side
    return { owners }
  }

  /**
   * sessions.seen: capture stored a turn of an OpenCode session (DESIGN §15.1,
   * B8). The session is the **gateway's verified `x-records-session`**, never a
   * body field, so a caller cannot claim a session it is not in. The row goes to
   * the person's personal space, whatever space is active, and the **first**
   * side to see the session keeps it: capture never re-owns a session History
   * recorded, and History never re-owns one capture recorded. Both sides always
   * store their transcript; curation is skipped at read time by the owner.
   *
   * The turn itself is the cell's; this row is written once per session, and
   * this call never waits on nor changes the capture's own write.
   */
  async sessionsSeen(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Recording a captured session needs the editor role in this space")
    requireObject(input, "sessions.seen")
    // The verified session only: a body's `session_id` is ignored, because any
    // editor could otherwise claim any session's curation.
    const session = a.session
    if (typeof session !== "string" || session === "" || session.length > 300) {
      throw invalid("invalid_session", "The caller names no session.", "Capture runs through the gateway, which sets x-records-session from the turn's own session.")
    }
    const own = this.#ownership(a)
    if (!own) {
      throw conflict(
        "personal_space_required",
        "A captured session is recorded in the person's own personal space, and this store has none for the caller.",
        "Write to the person's personal space once (Memory's console does on first use), then capture again.",
      )
    }
    const nowIso = this.#nowIso()
    return own.handle.tx(() => {
      const existing = own.handle.get("select first_side from sessions_seen where session_id = ?", session)
      if (!existing) {
        own.handle.run("insert into sessions_seen (session_id, first_side, first_event_id, at, updated) values (?, 'capture', null, ?, ?)", session, nowIso, nowIso)
        return { session_id: session, first_side: "capture", created: true, owned: "capture", space: own.spaceId }
      }
      if (existing.first_side === "capture") own.handle.run("update sessions_seen set updated = ? where session_id = ?", nowIso, session)
      // History saw it first: History owns its curation, and capture's turns are
      // the ones skipped. Nothing is withdrawn or rewritten.
      return { session_id: session, first_side: existing.first_side, created: false, owned: existing.first_side, space: own.spaceId }
    })
  }

  /** events.ingest: idempotent by id; 409 `source_unbound` until the person confirms the binding. */
  async ingestEvents(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Ingesting events needs the editor role in this space")
    const body = requireObject(input, "events.ingest")
    const { source, account } = this.#sourceKey(body)
    const owner = this.#owner(body.owner)
    if (!Array.isArray(body.events)) throw invalid("invalid_events", "events must be a list.", "Send the events events_list returned, oldest first.")
    if (body.events.length > 500) throw invalid("invalid_events", `${body.events.length} events in one call; the limit is 500.`, "Send them in pages of at most 500.")
    if (body.cursor !== undefined && body.cursor !== null && (typeof body.cursor !== "string" || body.cursor.length > 4000)) {
      throw invalid("invalid_events", "cursor must be text of at most 4000 characters.", "Send the cursor events_list returned.")
    }
    // The history anchor this page was read from (lane 0195b): the collector sends it on the one read that carries a `since`, so the events
    // older than the journal's live days are told apart from a genuine late arrival — which carries none, whatever its `occurred_at` — in
    // every engine mode. A caller may name any past `since` for its own space's page, and that only marks its own events: the mark never
    // leaves this space, and it can only make an event history, never a live one.
    let historySince = false
    if (body.since !== undefined && body.since !== null) {
      const at = typeof body.since === "string" ? Date.parse(body.since) : Number.NaN
      if (!Number.isFinite(at) || at > this.#settings.now().getTime() + 60_000) {
        throw invalid("invalid_events", "since must be an ISO date-time in the past: the start of the window this page was read from.", "Send the since the read carried, or leave it out.")
      }
      historySince = true
    }
    // The page's own `removals[]` (contract v0.2.0 #36), checked before anything
    // is written: a malformed list refuses the page rather than half of it.
    const listedRemovals = contractRemovals(body.removals)
    const handle = this.#writer(a)
    // This adapter supports only a page that owns the actual outer COMMIT.
    // Reject before pending bindings, gaps, caches or any page writes change.
    if (this.#settings.silverIngest && handle.depth > 0) throw new Error("silver_ingest_transaction_required")
    const nowIso = this.#nowIso()
    const historyBefore = historySince ? this.#journalHistoryBefore(handle, this.#settings.now()) : null
    const binding = handle.get("select * from sources where source = ? and account = ?", source, account)
    if (!binding || binding.status !== "confirmed" || binding.owner_id !== owner.id || !binding.enabled) {
      if (!binding) {
        handle.run(
          "insert into sources (source, account, owner_id, owner_label, status, enabled, created, updated) values (?, ?, ?, ?, 'pending', 1, ?, ?)",
          source,
          account,
          owner.id,
          owner.label,
          nowIso,
          nowIso,
        )
      } else if (binding.status === "pending") {
        handle.run("update sources set owner_id = ?, owner_label = ?, updated = ? where source = ? and account = ?", owner.id, owner.label, nowIso, source, account)
      }
      const why = !binding || binding.status === "pending"
        ? `${source} (${account}) has not been confirmed for this space.`
        : binding.status === "refused"
          ? `The person refused collection from ${source} (${account}).`
          : !binding.enabled
            ? `Collection from ${source} (${account}) is turned off.`
            : `${source} (${account}) is bound to ${binding.owner_label ?? binding.owner_id}, not to ${owner.label}.`
      throw conflict("source_unbound", `${why} Nothing was stored.`, `Show the person the owner below and ask whether to collect from it; on a yes, call sources.bind {source: "${source}", account: "${account}", owner, enabled: true}.`, {
        binding: {
          source,
          account,
          owner,
          status: binding?.status ?? "pending",
          ...(binding?.status === "confirmed" ? { bound_owner: { id: binding.owner_id, label: binding.owner_label } } : {}),
        },
      })
    }
    // Plugin-declared sources (S2): the consent of (source, account), never the payload, decides.
    const silver = this.#settings.silverIngest
    const wireRefusals = []
    const incoming = silver?.prepare ? body.events.flatMap((raw) => {
      const prepared = silver.prepare(raw)
      if (!prepared.error) return [prepared.wire]
      wireRefusals.push({ external_id: null, kind: null, reason: prepared.error })
      return []
    }) : body.events
    const declared = pluginConsent.checkIngest(handle, { source, account, owner, scope: body.scope }, incoming)
    declared.refusals.push(...wireRefusals)
    // §8.3.4: a page may say its source restarted its window. One resync a day
    // per binding — `window-truncated` included — and a second pauses the binding
    // rather than reading again blind. The pause is committed **before** the
    // refusal: a throw inside the page's transaction would roll it back.
    const gap = gapOf(body.gap)
    // A page that saves a cursor advances the binding; a page that holds it
    // (failed[], no cursor) is read again at the same position. Only a held
    // repeat is the resync already counted (A2).
    const held = typeof body.cursor !== "string"
    let resync = false
    if (gap) {
      const day = nowIso.slice(0, 10)
      const seen = handle.get("select reason, since, cursor from binding_resyncs where source = ? and account = ? and day = ?", source, account, day)
      // The day's count is per **distinct gap at a held position**: a page that
      // also held its cursor (`failed[]`) is read again on the next run with the
      // same gap, and that is the resync already counted — never a second one.
      // A gap repeated while the cursor **advances** is a new restart, and counts
      // again (A2: four restarts in a day used to be accepted as one).
      const same =
        Boolean(seen) &&
        seen.reason === gap.reason &&
        String(seen.since ?? "") === String(gap.since ?? "") &&
        held
      if (seen && !same) {
        handle.run(
          "update plugin_consents set state = 'paused', reason = ?, updated = ? where source = ? and account = ? and state = 'on'",
          `${source} restarted its window twice today; waiting until tomorrow`.slice(0, 200),
          nowIso,
          source,
          account,
        )
        throw conflict("resync_refused", `${source} (${account}) restarted its window twice today; the binding waits until tomorrow rather than read a third time blind.`, "Look at the source in Memory's console, then turn it back on tomorrow.")
      }
      if (!seen) {
        handle.run(
          "insert into binding_resyncs (source, account, day, job_id, run_id, reason, since, at, cursor) values (?, ?, ?, '', '', ?, ?, ?, ?) on conflict(source, account, day) do nothing",
          source,
          account,
          day,
          gap.reason,
          gap.since,
          nowIso,
          binding.cursor ?? null,
        )
      } else if (!same) {
        // The cursor advanced since the counted resync: this one is new, and it
        // takes the day's row (the day's limit is the binding's).
        handle.run("update binding_resyncs set reason = ?, since = ?, at = ?, cursor = ? where source = ? and account = ? and day = ?", gap.reason, gap.since, nowIso, binding.cursor ?? null, source, account, day)
      }
      resync = true
    }
    /**
     * The event's `history` mark: 1 when it occurred before the start of the journal's live days — **the local day before the read's own
     * day**, in the zone the routine journals in (the index page's `fields.tz`, else UTC). The routine writes a journal for today and for
     * yesterday, so an item from either still reaches its journal, and only the older ones are kept out of every journal as history.
     */
    const historyOf = (event) => (historyBefore && event.occurred_at < historyBefore ? 1 : 0)
    // Ownership is written **inside** the page's transaction, so the events and
    // the session row can never diverge (B8 rework); only History's own events
    // may name a session, by the package the binding's consent pins.
    const packageName = handle.get("select package_name from plugin_consents where source = ? and account = ?", source, account)?.package_name
    const own = this.#ownership(a)
    const silverResults = [], proposals = [], committedDeltas = []
    const latestProposal = new Map()
    let readyAfterCommit = null, workAfterCommit = false, deltaSuperseded = false
    const selectionKey = (object) => JSON.stringify([source, account, object])
    const supersedeSelection = (object) => {
      const key = selectionKey(object)
      const previous = latestProposal.get(key)
      if (previous) { previous.superseded = true; deltaSuperseded = true; latestProposal.delete(key) }
    }
    const ingestPerson = handle.ingestPerson
    const silverPage = (raw, event) => {
      const current = handle.get("select * from sources where source=? and account=?", source, account)
      const consent = handle.get("select plugin_id from plugin_consents where source=? and account=?", source, account)
      const plugin = consent && this.#pluginRow(handle.get("select * from plugins where plugin_id=?", consent.plugin_id), Date.parse(nowIso))
      return { identity: { source, account, object: event.external_id }, raw, event, actor: a, scope: body.scope ?? {}, descriptor: plugin?.manifest?.contract === "sources" ? plugin.manifest.descriptor : null, binding: current, cursor: body.cursor ?? null, nowIso,
        eraseDerivative: (id) => {
          const record = handle.get("select kind from records where id=?", id)
          if (record) this.#auditDelete(handle, SYSTEM_ACTOR, { id, kind: record.kind }, "forget")
          this.#hardDelete(handle, id)
          handle.erasePending = true
        },
      }
    }
    let answer
    try {
      answer = handle.tx(() => {
      // The engine's ingest half (S3a, design §10.1): enrol any row an earlier
      // build left unnumbered, then number, hash and lane this page's events.
      // With `RECORDS_ENGINE=off` this is null and nothing below it changes.
      const engine = this.#engineIngest(handle, { a, binding, nowIso })
      let accepted = 0
      let duplicates = 0
      const refusals = [...declared.refusals]
      // The refusal audit: a refused event is an answer the contract's policy
      // advances past (`policy.js` `cursorAdvance`), so it is never a silent
      // drop. One row each, ids and the refusal's sentence only, in this
      // transaction: whatever happens to the run's own report, the count, the
      // newest id and the reason stay on the binding (DESIGN §2.3.1).
      const refusedRows = declared.refusals.map((refusal) => ({ external_id: refusal.external_id ?? null, kind: refusal.kind ?? null, reason: refusal.reason }))
      // The events this page removed (§5.3): nothing is retracted for one until
      // its own row is written, and a repeat of the same tombstone retracts
      // nothing a second time (`events.removed_at`).
      const removals = []
      for (const raw of declared.events) {
        const prepared = silver?.prepare ? silver.prepare(raw) : { wire: raw }
        const { event, error } = prepared.error ? { error: prepared.error } : this.#normalizeEvent(prepared.wire, { source, account })
        if (error) {
          const safe = prepared.error ? null : prepared.wire
          const externalId = isPlainObject(safe) && safe.external_id !== undefined ? String(safe.external_id).slice(0, 100) : null
          refusals.push({ external_id: externalId, reason: error })
          refusedRows.push({ external_id: externalId, kind: isPlainObject(safe) && typeof safe.kind === "string" ? safe.kind.slice(0, 40) : null, reason: error })
          continue
        }
        const id = eventId(source, account, event.external_id)
        // A person forgot this item (design §8.5): its keyed-hash ref tombstone
        // keeps a re-sync or a backfill from bringing it back. Refused, audited,
        // and the cursor moves past it, as every refusal does.
        if (this.#refForgotten(handle, id)) {
          refusals.push({ external_id: event.external_id, reason: "a person forgot this item" })
          refusedRows.push({ external_id: event.external_id, kind: event.kind, reason: "a person forgot this item" })
          continue
        }
        // The session the event names, recorded, never refused: both sides keep
        // their transcript, and curation alone is skipped (read time, B8).
        const session = sessionIdOf(event, packageName)
        const existing = handle.get("select hash, removed_at, url, title, text, actors, meta, seq, lane, content_hash, reentry_day, reentry_count from events where id = ?", id)
        // All baseline admission/suppression precedes the constructor adapter.
        // Its independent source ordering must also see identical wire retries.
        if (silver && !existing && isFarFuture(event.occurred_at, nowIso)) {
          refusals.push({ external_id: event.external_id, reason: FUTURE_EVENT_REASON })
          refusedRows.push({ external_id: event.external_id, kind: event.kind, reason: FUTURE_EVENT_REASON })
          continue
        }
        // Every later baseline-admitted input supersedes this invocation's
        // earlier same-object selection, even a replay, gap or withheld text.
        if (silver) supersedeSelection(event.external_id)
        if (silver && !removalOf(event)) {
          const page = silverPage(prepared.wire, event)
          const result = silver(handle, page)
          if (result?.disposition) {
            const { delta, ...summary } = result
            silverResults.push(summary)
            if (delta) {
              const proposal = { page, delta, summary, superseded: false }
              proposals.push(proposal)
              latestProposal.set(selectionKey(event.external_id), proposal)
            }
          }
        }
        if (existing && existing.hash === event.hash) {
          duplicates += 1
          continue
        }
        // Silver has its own opaque membership after Bronze expires. Its
        // erasure must not depend on finding the old event or display cites.
        const silverRemoval = removalOf(event)
        if (silverRemoval) this.#invalidateSilver(handle, { identity: { source, account, object: event.external_id } })
        // A tombstone's row keeps its labels and loses its words, its name and
        // its link; a later event with real words is the "put back" case.
        const removal = removalOf(event)
        const removedAt = removal ? nowIso : null
        // What the engine reads (S3a): the content hash decides whether this is
        // new content, and the lane is assigned once, when the row is born.
        const content = engine ? contentHash(event) : null
        if (existing) {
          // A new seq only when the content changed and the day's re-entry
          // count allows one; a relabelled item keeps its seq (design §12,
          // decision 8). A lane is never reassigned on an update, so a row can
          // never move below a cursor it has already passed.
          //
          // A row an older build wrote has no content hash, so the comparison is
          // against the hash its own stored content has: its first relabelling
          // is not new content (review M1).
          const stored = existing.content_hash === null ? storedContentHash(existing) : undefined
          const reentry = engine ? reentryOf(existing, { hash: content, day: nowIso.slice(0, 10), counter: engine.counter, stored }) : null
          const lane = existing.lane ?? (engine ? engine.laneOf(event) : null)
          // A re-entry is work the lane has not read yet: the space says so.
          if (reentry && reentry.seq !== existing.seq && lane) engine.touched.add(lane)
          handle.run(
            "update events set kind = ?, occurred_at = ?, thread = ?, actors = ?, title = ?, text = ?, url = ?, labels = ?, hash = ?, ingested_at = ?, session_id = coalesce(?, session_id), removed_at = ?, meta = ?, seq = ?, lane = ?, content_hash = ?, reentry_day = ?, reentry_count = ?, history = coalesce(history, ?) where id = ?",
            event.kind,
            event.occurred_at,
            event.thread,
            JSON.stringify(event.actors),
            removal ? null : event.title,
            removal ? null : event.text,
            removal ? null : event.url,
            JSON.stringify(event.labels),
            event.hash,
            nowIso,
            session,
            removedAt,
            // A removal takes the v0.3 metadata with the words, the name and the
            // link: a removal row keeps no section, no part and no fact title.
            removal || event.meta === undefined ? null : JSON.stringify(event.meta),
            reentry ? reentry.seq : existing.seq,
            lane,
            reentry ? reentry.content_hash : existing.content_hash,
            reentry ? reentry.reentry_day : existing.reentry_day,
            reentry ? reentry.reentry_count : existing.reentry_count,
            historyOf(event),
            id,
          )
        } else {
          // A new record of what happened cannot be a month in the future. A
          // source's unbounded first read can expand a weekly series years
          // ahead (lane 0197). Only a new event is judged: a duplicate, a
          // person's tombstone and a removal were handled above, so a stored
          // far-future event can still be deduped, forgotten or removed.
          if (isFarFuture(event.occurred_at, nowIso)) {
            refusals.push({ external_id: event.external_id, reason: FUTURE_EVENT_REASON })
            refusedRows.push({ external_id: event.external_id, kind: event.kind, reason: FUTURE_EVENT_REASON })
            continue
          }
          // The seq comes from the meta counter, never `max(seq) + 1`.
          const seq = engine ? engine.counter.take() : null
          const lane = engine ? engine.laneOf(event) : null
          if (engine && lane) engine.touched.add(lane)
          handle.run(
            `insert into events (id, source, account, external_id, kind, occurred_at, thread, actors, title, text, url, labels, hash, ingested_at, session_id, removed_at, meta, seq, lane, content_hash, reentry_day, reentry_count, history)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            id,
            source,
            account,
            event.external_id,
            event.kind,
            event.occurred_at,
            event.thread,
            JSON.stringify(event.actors),
            removal ? null : event.title,
            removal ? null : event.text,
            removal ? null : event.url,
            JSON.stringify(event.labels),
            event.hash,
            nowIso,
            session,
            removedAt,
            event.meta === undefined ? null : JSON.stringify(event.meta),
            seq,
            lane,
            content,
            engine ? nowIso.slice(0, 10) : null,
            engine ? 0 : null,
            historyOf(event),
          )
        }
        if (session) this.#sessionSeenHistory(own, session, id, nowIso)
        // Only a file Memory actually held retracts and notifies (0.11 review,
        // B3): a first page carrying historical tombstones records unworded rows
        // and must not flood the person's journal with files they never had.
        if (removal && existing && !existing.removed_at) {
          // The words and the name are read **before** the row loses them: they are
          // what a derived body may still quote (0.11 review R2-B1).
          removals.push({ eventId: id, externalId: event.external_id, reason: removal.reason, url: existing.url ?? null, title: existing.title ?? null, text: existing.text ?? null })
        }
        accepted += 1
      }
      // A change that came after the day's cap sat below its cursor, so the lane
      // would never read it. The next day's first page re-queues it, once: the
      // content it holds now is read (review L3). After the loop, so a page that
      // also carries a change takes that change's own seq.
      if (engine) {
        const requeued = requeueCapped(handle, { now: nowIso, counter: engine.counter })
        for (const lane of requeued.lanes) engine.touched.add(lane)
      }
      // One counter write for the page, in the same transaction as its rows: a
      // rollback takes the seqs back with the events (S3a).
      engine?.counter.save()
      // A space with lanes and no marker says so once (design §10.5): the
      // scheduler finds it by listing `spaces/*.ready`, never by opening it.
      if (engine?.personal && engine.touched.size > 0) {
        const state = { lanes: [...engine.touched], deadline: null, pendingTokens: null }
        if (silver) readyAfterCommit = state
        else this.#settings.markReady(this.#spaceId, state)
      }
      // The contract's own removals (§5.4, v0.2.0): the source says what it
      // removed, so nothing is inferred. Only an event Memory actually held
      // retracts and notifies, exactly as a re-emitted tombstone must be one
      // Memory held; a repeat of the same removal finds `removed_at` and retracts
      // nothing a second time. The row loses its words, its name and its link, as
      // a tombstone's does, and keeps the reason on its labels — where the drain,
      // which may finish in a later tick, reads why.
      for (const entry of listedRemovals) {
        const id = eventId(source, account, entry.externalId)
        if (silver) supersedeSelection(entry.externalId)
        this.#invalidateSilver(handle, { identity: { source, account, object: entry.externalId } })
        if (removals.some((removal) => removal.eventId === id)) continue
        const held = handle.get("select removed_at, labels, url, title, text from events where id = ?", id)
        if (!held || held.removed_at) continue
        removals.push({ eventId: id, externalId: entry.externalId, reason: entry.reason, url: held.url ?? null, title: held.title ?? null, text: held.text ?? null })
        handle.run(
          // The v0.3 metadata is content too, so it goes with the words, the name
          // and the link (source-contract #46 §2, §3): a removal row keeps none.
          "update events set title = null, text = null, url = null, meta = null, labels = ?, removed_at = ? where id = ?",
          labelsWith(held.labels, entry.reason),
          entry.at,
          id,
        )
      }
      // A record written before this build has no `cite` edge yet: fill them in
      // first, a time-budgeted slice at a time, so a removal finds it too
      // (0.11 review R5-B1, R6-B1).
      this.#citeBackfill(handle)
      // The page's own removals join whatever an earlier page left pending: one
      // queue, drained within this tick's budget (R5-B1, R6-S2).
      for (const removal of removals) {
        // The link the tombstone took off the row is kept only until the removal
        // finishes, so a record that cites it loses the link too.
        handle.run("update events set retract_pending = 1, retract_url = ? where id = ?", removal.url ?? null, removal.eventId)
      }
      // **Never on a partial index**: while citations are still being filled, a
      // lookup would miss the records not yet indexed, and mark the removal done
      // (0.11 review R6-B1). The removal waits, truthfully reported as pending.
      const indexing = (handle.get("select value from meta where key = 'cite_edges'")?.value ?? "") !== "done"
      const drained = indexing ? null : this.#drainPending(handle, a, { source, account, nowIso })
      const deferred = new Set(drained?.pending ?? [])
      const retractions = removals.map((removal) => {
        const entry = drained?.per.get(removal.eventId) ?? { retired: [], kept: [], scrubbed: [] }
        return { event: removal.eventId, external_id: removal.externalId, reason: removal.reason, ...entry, copies: drained?.copies ?? [], notice: drained?.notice ?? null }
      })
      const retracted = retractions.filter((entry) => !deferred.has(entry.event) && drained?.per.has(entry.event)).length
      // The space's count, not this binding's: the answer and the marker say what
      // the whole space still owes (0.11 review R8-B2).
      const removalsPending = Number(handle.get("select count(*) as n from events where retract_pending = 1")?.n ?? 0)
      // A space with work left says so, so the service's own worker finds it
      // without scanning every space (0.11 review R7). It is the **space's**
      // count, never this binding's, and an ingest only ever sets the marker:
      // only the worker that finds no work clears it (R8-B2), so another
      // binding's quiet ingest cannot hide a removal that still waits.
      if (removalsPending > 0 || indexing) {
        if (silver) workAfterCommit = true
        else this.#settings.markWork(this.#spaceId, true)
      }
      // The removed words are out of the tables, and the pages the checkpoint
      // rewrites no longer hold them (secure_delete). The WAL still does, so it
      // is truncated once this transaction commits (0.11 review, S2): a
      // checkpoint inside it cannot run.
      if (drained && drained.records > 0) handle.erasePending = true
      let cursorSaved = false
      if (typeof body.cursor === "string") {
        handle.run("update sources set cursor = ?, cursor_at = ?, updated = ? where source = ? and account = ?", body.cursor, nowIso, nowIso, source, account)
        cursorSaved = true
      }
      for (const row of refusedRows) {
        handle.run(
          "insert into event_refusals (at, source, account, external_id, kind, reason) values (?, ?, ?, ?, ?, ?)",
          nowIso,
          source,
          account,
          row.external_id,
          row.kind,
          String(row.reason ?? "refused").slice(0, 300),
        )
      }
      const newest = refusedRows.at(-1) ?? null
      for (const proposal of proposals) {
        const current = !proposal.superseded && silver.current?.(handle, silverPage(proposal.page.raw, proposal.page.event), proposal.delta)
        if (current === true) committedDeltas.push(proposal)
        else {
          proposal.summary.coverage = [...proposal.summary.coverage, "delta_superseded"]
          deltaSuperseded = true
        }
      }
      return {
        accepted,
        duplicates,
        refused: refusals.length,
        ...(newest ? { newest_refusal: { external_id: newest.external_id, kind: newest.kind, reason: String(newest.reason ?? "refused").slice(0, 300) } } : {}),
        cursor_saved: cursorSaved,
        ...(resync ? { resync: true, gap } : {}),
        ...(gap ? { incomplete: true } : {}),
        ...(refusals.length ? { refusals: refusals.slice(0, 20) } : {}),
        ...(retractions.length ? { removals: retractions.slice(0, 20), retracted } : {}),
        // Every answer says what still waits, a quiet tick included (R6-S2).
        removals_pending: removalsPending,
        ...(indexing ? { index_building: true } : {}),
        ...(silver ? { silver: silverResults } : {}),
      }
      })
    } finally {
      // This read cache describes the pre-page binding/person, not committed
      // work. Do not leave a new cache behind on an aborted adapter page.
      if (silver) handle.ingestPerson = ingestPerson
    }
    // Nothing above publishes work on the installed-adapter path. Publication
    // failure is a committed/resync result, never a pretend SQL rollback.
    if (silver) {
      try {
        if (readyAfterCommit) this.#settings.markReady(this.#spaceId, readyAfterCommit)
        if (workAfterCommit) this.#settings.markWork(this.#spaceId, true)
        for (const { page, delta } of committedDeltas) {
          // A previous callback can change consent. Recheck each notification
          // in a fresh, short transaction with synchronous readers only.
          const current = handle.tx(() => silver.current(handle, { ...silverPage(page.raw, page.event), nowIso: this.#nowIso() }, delta))
          if (current !== true) { deltaSuperseded = true; continue }
          const result = this.#settings.onSilverDelta?.(delta)
          if (result && typeof result.then === "function") {
            Promise.resolve(result).catch(() => {})
            throw new Error("async_silver_publication")
          }
        }
        if (deltaSuperseded) answer.silver_publication = { committed: true, resync: true, reason: "delta_superseded" }
      } catch {
        answer.silver_publication = { committed: true, resync: true, reason: "postcommit_failed" }
      }
    }
    // A removal's words are gone from the rows; the WAL that held the frames
    // they were written in is truncated now that the transaction has committed.
    if (handle.erasePending && handle.file) {
      if (!silver) this.#truncateWal(handle)
      else {
        try { this.#truncateWal(handle) }
        catch { answer.silver_publication = { committed: true, resync: true, reason: "postcommit_failed" } }
      }
    }
    return answer
  }

  /**
   * What retention is about to delete before the engine read it (S3a, design
   * §10.5 and I7): the rows above their lane's cursor, and the ones the retry
   * set still holds, counted into `lane_expired` by day, source and lane. A
   * trait hold whose event is about to go is counted with them (the plan's
   * decision 2): there is nothing left for the classifier to retry.
   *
   * It runs inside the transaction that deletes the events, so a count and a
   * deletion can never disagree.
   */
  #countExpired(handle, { eventCutoff, nowIso }) {
    const day = String(nowIso ?? "").slice(0, 10)
    // One row per event, whatever reasons it has: above its cursor, in the retry
    // set, or held by the trait gate. Three `exists` and no join, so an event
    // held twice and waiting in the retry set is still one loss.
    for (const row of handle.all(
      `select e.source as source, e.lane as lane, count(*) as n from events e
        where e.ingested_at < ? and e.lane is not null
          and (e.seq > coalesce((select c.cursor from lane_cursors c where c.lane = e.lane and c.source = e.source and c.account = e.account), 0)
               or exists (select 1 from lane_retry r where r.event_id = e.id)
               or exists (select 1 from trait_holds h where h.ref = e.id))
        group by e.source, e.lane`,
      eventCutoff,
    )) {
      const count = Number(row.n) || 0
      if (!row.source || !row.lane || !count) continue
      handle.run(
        `insert into lane_expired (day, source, lane, "count") values (?, ?, ?, ?)
         on conflict(day, source, lane) do update set "count" = "count" + excluded."count"`,
        day,
        row.source,
        row.lane,
        count,
      )
    }
  }

  /**
   * The engine's ingest half (S3a, design §10.1 and §12): enrol rows an earlier
   * build left unnumbered, and hand the page's loop a counter, the lane rule and
   * the space's watermark. `null` while `RECORDS_ENGINE` is off, so the ingest
   * writes exactly what 0.13.0 wrote.
   */
  #engineIngest(handle, { a, binding, nowIso }) {
    if (!engineOn(this.#settings.engine)) return null
    const personal = (handle.meta?.space_kind ?? a.spaceKind) === "personal"
    const { watermark, numbered } = enroll(handle, { now: nowIso, personal })
    const person = personal ? this.#ingestPerson(handle, { a, binding }) : null
    // The lane rule's constant work, once per page: the 24-hour window and the
    // cutover are parsed here, not for every event.
    const context = laneContext({ binding, person, watermark })
    // The rows enrolment numbered are work the lane has not read: the space says
    // so like any other page. `requeueCapped`'s rows join it after the loop.
    const touched = new Set()
    if (personal && numbered > 0) touched.add("backfill")
    return {
      personal,
      counter: seqCounter(handle),
      touched,
      // A shared space gets a seq and no lane: nothing of a team space is ever
      // leased (§8.4).
      laneOf: (event) => (personal ? laneOf(event, context) : null),
    }
  }

  /**
   * The person, for the lane rule, from the binding that delivered the page and
   * the identities the person confirmed in the console (design §6): the same
   * `personFrom` the routines build, so there is one self rule and no second
   * one in the engine.
   */
  #ingestPerson(handle, { a, binding }) {
    // Once per handle: two queries and a JSON parse on every page is a page's
    // worth of work for an answer that changes only when a binding or the index
    // page does, and those writes clear it (`#forgetIngestPerson`).
    if (handle.ingestPerson) return handle.ingestPerson
    const sources = handle.all("select source, account, owner_id, owner_label, status from sources")
    const index = handle.get("select fields from records where kind = 'page' and path = 'index'")
    let fields = {}
    try {
      fields = JSON.parse(index?.fields ?? "{}") ?? {}
    } catch {
      fields = {}
    }
    handle.ingestPerson = personFrom({
      user: a.user ?? null,
      label: binding?.owner_label ?? a.user ?? "you",
      sources,
      identities: fields.identities ?? {},
      names: fields.aliases ?? [],
      shared: false,
    })
    return handle.ingestPerson
  }

  /**
   * The lane rule's person is stale after a write that changes who the person is
   * on which binding: a bind or an unbind, and the space's index page (its
   * identities and aliases).
   */
  #forgetIngestPerson(handle) {
    if (handle) handle.ingestPerson = null
  }

  /**
   * The one-time fill of `cite` edges for records and versions written before
   * they existed (0.11 review R5-B1, R6-S4). It runs **in time-budgeted slices**
   * from the collector's ingest and from maintenance, resumable from `meta`, so
   * a big space finishes in minutes without ever holding the loop; `meta.cite_edges`
   * says `done` only when both phases are complete, and until then no removal is
   * retracted on the partial index (R6-B1).
   */
  #citeBackfill(handle, { budgetMs = this.#settings.backfillSliceMs(), chunk = 500 } = {}) {
    const read = () => handle.get("select value from meta where key = 'cite_edges'")?.value ?? ""
    const write = (value) => handle.run("insert into meta (key, value) values ('cite_edges', ?) on conflict(key) do update set value = excluded.value", value)
    // One key, written as one value, so a state can never disagree with itself
    // (R6-B1): "" (not started), a cursor, or `done`.
    const raw = read()
    if (raw === "done") return 0
    let state = { phase: "records", afterId: "", afterVersion: 0 }
    if (raw) {
      try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === "object") state = { phase: parsed.phase === "versions" ? "versions" : "records", afterId: String(parsed.afterId ?? ""), afterVersion: Number(parsed.afterVersion ?? 0) || 0 }
      } catch {
        state = { phase: "records", afterId: "", afterVersion: 0 }
      }
    }
    const deadline = this.#settings.clock() + budgetMs
    let filled = 0
    const index = (src, body, fields) => {
      for (const event of citeEventsOf({ body, fields })) {
        filled += Number(handle.run("insert or ignore into links (src, dst, type) values (?, ?, 'cite')", src, event).changes)
      }
    }
    if (state.phase === "records") {
      while (this.#settings.clock() < deadline) {
        const rows = handle.all("select id, body, fields from records where id > ? order by id limit ?", state.afterId, chunk)
        for (const row of rows) {
          // The clock is read between backfill rows too (0.11 review R8-B3).
          if (this.#settings.clock() > deadline) break
          let fields = {}
          try {
            fields = JSON.parse(row.fields ?? "{}")
          } catch {
            fields = {}
          }
          index(row.id, row.body, fields)
          state.afterId = row.id
        }
        if (rows.length < chunk) {
          state = { phase: "versions", afterId: "", afterVersion: 0 }
          write(JSON.stringify(state))
          break
        }
        write(JSON.stringify(state))
      }
      if (state.phase === "records") return filled
    }
    // Phase two: citations only a stored version still holds, because a later
    // edit took them out of the current row (R6-S4).
    while (this.#settings.clock() < deadline) {
      const rows = handle.all(
        "select record_id, version, snapshot from versions where record_id > ? or (record_id = ? and version > ?) order by record_id, version limit ?",
        state.afterId,
        state.afterId,
        state.afterVersion,
        chunk,
      )
      for (const row of rows) {
        if (this.#settings.clock() > deadline) break
        let snapshot
        try {
          snapshot = JSON.parse(row.snapshot)
        } catch {
          snapshot = null
        }
        if (snapshot) index(row.record_id, snapshot.body, snapshot.fields)
        state.afterId = row.record_id
        state.afterVersion = Number(row.version)
      }
      write(rows.length < chunk ? "done" : JSON.stringify(state))
      if (rows.length < chunk) break
    }
    return filled
  }

  /**
   * Drain this binding's pending removals within one tick's time budget (0.11
   * review R5-B1, R6-S2): batches of at most `MAX_REMOVALS_PER_INGEST`, each
   * event resumed from **its own** `retract_after` (R6-B2), until the budget is
   * spent, nothing waits, or a batch makes no progress.
   */
  #drainPending(handle, a, { source, account, nowIso, budgetMs = this.#settings.drainSliceMs() }) {
    const per = new Map()
    const resume = new Map()
    const pending = new Set()
    const copies = []
    const completed = []
    let notice = null
    let records = 0
    const deadline = this.#settings.clock() + budgetMs
    while (this.#settings.clock() < deadline) {
      const rows = handle.all(
        "select id, external_id, labels, url, retract_url, retract_after from events where source = ? and account = ? and retract_pending = 1 order by occurred_at, id limit ?",
        source,
        account,
        MAX_REMOVALS_PER_INGEST,
      )
      if (rows.length === 0) break
      const batch = rows.map((row) => ({
        eventId: row.id,
        externalId: row.external_id,
        // The reason the source gave, off the row's labels: a contract removal
        // keeps `expired` as its own word, and a label tombstone's `gone` is the
        // deletion it means.
        reason: String(row.labels ?? "").includes("withheld") ? "withheld" : String(row.labels ?? "").includes("expired") ? "expired" : "gone",
        url: row.retract_url ?? row.url ?? null,
        after: row.retract_after ?? "",
      }))
      // The record budget is the tick's, not one batch's: a tick rewrites at
      // most `MAX_RETRACT_RECORDS`, so a page finishes in a few ticks (R6-S2).
      const done = this.#retractPage(handle, a, batch, { source, account, nowIso, budget: Math.max(0, MAX_RETRACT_RECORDS - records), deadline })
      let progressed = false
      for (const removal of batch) {
        const entry = done.per.get(removal.eventId) ?? { retired: [], kept: [], scrubbed: [] }
        const more = done.pending.includes(removal.eventId)
        const next = more ? done.resume.get(removal.eventId) ?? removal.after : null
        if (next !== removal.after) progressed = true
        handle.run("update events set retract_pending = ?, retract_after = ?, retract_url = ? where id = ?", more ? 1 : 0, next, more ? removal.url ?? null : null, removal.eventId)
        per.set(removal.eventId, entry)
        resume.set(removal.eventId, next)
        if (more) pending.add(removal.eventId)
      }
      copies.push(...done.copies)
      for (const entry of done.completed) completed.push(entry)
      records += done.records
      if (!progressed || records >= MAX_RETRACT_RECORDS) break
    }
    // One notice for the tick, however many batches it took (R6-S1).
    if (completed.length > 0) {
      const waiting = [...pending].reduce((sum, event) => sum + (resume.get(event) ? 1 : 0), 0)
      notice = this.#removalNotice(handle, a, { removals: completed, per, copies, nowIso, waiting })
    }
    return { per, pending: [...pending], resume, copies, notice, records }
  }

  /**
   * What a batch of removals retracts (§5.2), found by lookup and bounded
   * (0.11 review R5-B1, R6-B2):
   *
   * - each event is looked up **by its own `retract_after`**, so one event's
   *   progress never hides another's records; an event is done only when its
   *   own lookup finds nothing past its own resume point;
   * - each record is loaded and saved **once**, whatever number of the batch's
   *   events it cites, and its versions are scrubbed once per event;
   * - the audit row is written **once, on completion** (R6-S1);
   * - the notice is written only when at least one event completed, and says
   *   what was retracted and what still waits (R6-S1).
   *
   * @returns {{per: Map<string, object>, copies: object[], notice: string|null, pending: string[], resume: Map<string, string|null>, records: number}}
   */
  #retractPage(handle, a, removals, { source, account, nowIso, budget = MAX_RETRACT_RECORDS, deadline = this.#settings.clock() + this.#settings.drainSliceMs() }) {
    const byEvent = new Map(removals.map((removal) => [removal.eventId, removal]))
    const per = new Map([...byEvent.keys()].map((event) => [event, { retired: [], kept: [], scrubbed: [] }]))
    const derived = new Map()
    const pending = new Set()
    const resume = new Map()
    if (byEvent.size === 0) return { per, copies: [], pending: [], resume, records: 0, completed: [] }
    let remaining = budget
    for (const removal of removals) {
      // Asked even with no budget left: one row tells whether the event still
      // has records to reach, so a spent budget leaves it pending rather than
      // marking it done (0.11 review R6-B2).
      const rows = handle.all("select src from links where type in ('cite', 'source') and dst = ? and src > ? order by src limit ?", removal.eventId, removal.after ?? "", remaining + 1)
      const take = rows.slice(0, remaining)
      for (const row of take) {
        if (!derived.has(row.src)) derived.set(row.src, new Set())
        derived.get(row.src).add(removal.eventId)
      }
      remaining -= take.length
      // The event's own resume point: past the last record this tick handled
      // when its lookup had more, cleared when it had none left.
      if (rows.length > take.length) {
        pending.add(removal.eventId)
        resume.set(removal.eventId, take.at(-1)?.src ?? removal.after ?? "")
      } else resume.set(removal.eventId, null)
    }
    // How many records each event still has here, so a slice that runs out of
    // time leaves exactly those events pending, resumed past what it did.
    const left = new Map(removals.map((removal) => [removal.eventId, 0]))
    for (const cited of derived.values()) for (const event of cited) left.set(event, (left.get(event) ?? 0) + 1)
    const lastDone = new Map()
    const applied = []
    const touched = []
    const doneIds = []
    for (const id of derived.keys()) {
      if (applied.length >= budget) break
      applied.push(id)
    }
    for (const id of applied) {
      // The clock is read between record rewrites, not between batches (R8-B3).
      if (doneIds.length > 0 && this.#settings.clock() > deadline) break
      doneIds.push(id)
      for (const event of derived.get(id)) {
        left.set(event, (left.get(event) ?? 1) - 1)
        lastDone.set(event, id)
      }
      const record = this.#load(handle, id)
      if (!record) continue
      const cited = derived.get(id)
      const memoryLines = this.#memoryLines(handle, record)
      let next = record
      let withdraw = false
      for (const event of cited) {
        const info = byEvent.get(event)
        const pendingProposal = next.kind === "proposal" && (next.status === "proposed" || next.status === "accepting")
        if (pendingProposal) withdraw = true
        const scrub = removalScrub(next, { eventId: event, url: info.url, reason: info.reason, at: nowIso, withdraw: pendingProposal, memoryLines })
        next = { ...next, title: scrub.title, body: scrub.body, fields: scrub.fields, ...(pendingProposal ? { status: "retired" } : {}) }
      }
      this.#save(handle, record, next, this.#change(a, "source_removal", { events: [...cited] }))
      for (const event of cited) {
        const info = byEvent.get(event)
        this.#scrubVersionsForEvent(handle, id, { eventId: event, url: info.url, reason: info.reason, at: nowIso, withdraw })
        const entry = per.get(event)
        if (withdraw) entry.retired.push(id)
        else {
          entry.scrubbed.push(id)
          if (record.kind !== "proposal") entry.kept.push(id)
        }
      }
      touched.push(id)
    }
    const events = [...byEvent.keys()]
    const marks = events.map(() => "?").join(", ")
    const doneSet = new Set(doneIds)
    for (const [id, cited] of derived) {
      if (doneSet.has(id)) continue
      for (const event of cited) pending.add(event)
    }
    for (const event of pending) resume.set(event, lastDone.get(event) ?? byEvent.get(event)?.after ?? "")
    // A job's staged output is the event's words in another table, and its
    // extraction mark only says those words were sent: both go. The mark is
    // keyed by the job's connector, which is the source's plugin (S3).
    const connectors = new Set(handle.all(`select distinct connector from job_items where event_id in (${marks})`, ...events).map((row) => row.connector))
    for (const row of handle.all("select connector from jobs where source = ? and account = ?", source, account)) connectors.add(row.connector)
    handle.run(`delete from job_items where event_id in (${marks})`, ...events)
    for (const removal of removals) {
      for (const connector of connectors) handle.run("delete from job_extracted where connector = ? and account = ? and external_id = ?", connector, account, removal.externalId)
    }
    // A copy or a move whose original is gone is still a copy Memory cannot
    // retract: the notes are read by the record **and by the event**.
    const copyMarks = touched.map(() => "?").join(", ")
    const copies = handle
      .all(
        `select distinct record_id, space, copy_id from shared_copies where event_id in (${marks})${touched.length > 0 ? ` or record_id in (${copyMarks})` : ""} order by record_id, space`,
        ...events,
        ...touched,
      )
      .map((row) => ({ record: row.record_id, space: row.space, copy_id: row.copy_id || null }))
    const completed = removals.filter((removal) => !pending.has(removal.eventId))
    // SEC-0912: one ids-only audit row per removal, written once it is complete.
    for (const removal of completed) {
      handle.run(
        "insert into delete_audit (at, action, record_id, record_kind, actor_user, principal, credential, space) values (?, 'source_removal', ?, 'event', ?, ?, ?, ?)",
        nowIso,
        removal.eventId,
        a?.user ?? ROUTINE_USER,
        a?.principal === "agent" ? "agent" : "user",
        a?.credential === "session" ? "session" : "bearer",
        this.#spaceId ?? a?.space ?? null,
      )
    }
    return { per, copies, pending: [...pending], resume, records: touched.length, completed: completed.map((removal) => ({ eventId: removal.eventId, reason: removal.reason, url: removal.url })) }
  }

  /**
   * The page's removals, on the day's journal: ids only, and what the person can
   * do. **One write per page**, never one per removal (0.11 review R5-B1). It
   * names the events and the records, **never the file's name or path**
   * (0.11 review B3): a `withheld` file's identity is exactly what must not be
   * republished, and the ingest has already taken its name off the row.
   */
  #removalNotice(handle, a, { removals, per, copies, nowIso, waiting = 0 }) {
    const day = nowIso.slice(0, 10)
    const path = `journal/${day}`
    const same = removals.every((removal) => removal.reason === removals[0]?.reason)
    const reason = removals[0]?.reason
    const what = same && reason === "withheld" ? "withheld" : same && reason === "expired" ? "expired" : same ? "deleted" : "deleted, withheld or expired"
    const events = removals.map((removal) => removal.eventId).filter(Boolean)
    const ids = (key) => [...new Set(events.flatMap((event) => per.get(event)?.[key] ?? []))]
    const retired = ids("retired")
    const kept = ids("kept")
    // The plural is written as it stands, never assembled from a template (R6-S1).
    const said = [
      removals.length === 1
        ? `- Source removal: the item behind event ${events[0]} was ${what} at its source, so Memory retracted what it had drawn from it.`
        : `- Source removals (${removals.length} items): the items behind events ${events.join(", ")} were ${what} at their source, so Memory retracted what it had drawn from them.`,
    ]
    if (waiting > 0) said.push(`${waiting === 1 ? "One removal is" : `${waiting} removals are`} still retracting; the records they reach are finished in the next ticks.`)
    if (retired.length > 0) said.push(`Withdrawn, waiting for you: ${retired.join(", ")}.`)
    if (kept.length > 0) said.push(`Yours, kept with the file's quote and link taken off: ${kept.join(", ")}. Forget any you no longer want with mem_revise forget.`)
    if (copies.length > 0) {
      said.push(`Copies in other spaces Memory cannot retract: ${copies.map((copy) => `${copy.copy_id ?? copy.record} in ${copy.space}`).join(", ")}.`)
      // A copy chain that passes through a space the person cannot write in
      // stops there: say so, and name no space they cannot see (0.11 review R4).
      said.push("Further copies may exist where Memory could not follow (a space you cannot write in); they are not listed here.")
    }
    const line = said.join(" ")
    const page = handle.get("select * from records where path = ?", path)
    if (page) {
      const current = fromRow(page)
      const body = `${current.body.replace(/\s+$/, "")}\n${line}\n`
      this.#save(handle, current, { ...current, body }, this.#change(a, "source_removal", { events }))
    } else {
      this.#create(handle, a, newRecord({ kind: "page", type: "journal", path, title: `Journal ${day}`, body: `${line}\n` }, a, nowIso), this.#change(a, "source_removal", { events }))
    }
    return path
  }

  /** The same scrub in every stored version of one record, newest and oldest alike. */
  #scrubVersionsForEvent(handle, id, { eventId, url, reason, at, withdraw }) {
    for (const row of handle.all("select version, snapshot from versions where record_id = ?", id)) {
      let record
      try {
        record = JSON.parse(row.snapshot)
      } catch {
        continue
      }
      const next = removalScrub(record, { eventId, url, reason, at, withdraw, memoryLines: this.#memoryLines(handle, record) })
      handle.run("update versions set snapshot = ? where record_id = ? and version = ?", JSON.stringify({ ...record, title: next.title, body: next.body, fields: next.fields }), id, row.version)
    }
  }

  /**
   * records.copied: the copier's note that a record now has a copy (or was
   * moved) into another space (§5.2; `fields.copied_from` says the same from
   * the other side). A space cannot read another space's file — a cell may not
   * even hold both — so the removal reads this to report what it cannot
   * retract. `origin_event` is the event the original was drawn from, so a
   * **move** is still reported after the original is deleted. Ids only.
   */
  async noteCopies(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Registering a copy needs the editor role in this space")
    const body = requireObject(input, "records.copied")
    const to = text(body.to_space)
    if (!to || !SPACE_ID.test(to)) throw invalid("invalid_space", "to_space must be a space id.", "Send the id of the space the copy lives in.")
    const copies = Array.isArray(body.copies) ? body.copies : []
    if (copies.length === 0 || copies.length > 100) throw invalid("invalid_request", "copies must be a list of 1 to 100 {record, copy_id, origin_event?}.", "Send the copies the copy wrote, one per record.")
    const ids = copies.map((copy) => text(copy?.record) ?? "")
    if (ids.some((id) => !RECORD_ID.test(id))) throw invalid("invalid_record", "every copy names the record it copies (rec_…).", "Send {record: \"rec_…\", copy_id: \"rec_…\"}.")
    const events = copies.map((copy) => text(copy?.origin_event) ?? "")
    const badEvent = events.find((event) => event && !/^evt_[A-Za-z0-9]{1,64}$/.test(event))
    if (badEvent !== undefined) throw invalid("invalid_request", "origin_event must be an event id (evt_…).", "Send the event the original came from, or leave it out.")
    const handle = this.#writer(a)
    const nowIso = this.#nowIso()
    return handle.tx(() => {
      const forwards = []
      const known = new Set(handle.all(`select id from records where id in (${ids.map(() => "?").join(", ")})`, ...ids).map((row) => row.id))
      const missing = ids.filter((id) => !known.has(id))
      if (missing.length > 0) throw notFound(`No record ${missing.join(", ")} in this space.`, "Register a copy against the record that is here.")
      for (const [index, id] of ids.entries()) {
        const copyId = text(copies[index]?.copy_id) ?? ""
        // Every event the record derives from, read here rather than trusted
        // from the caller: the source edge, the fields a proposal cites, and a
        // body's citation. A record that rests on an event through any of them
        // is a copy of that event, however it got to this space (0.11 review
        // R2-B3). The caller's `origin_event` is one more, never the only one.
        const record = this.#load(handle, id)
        const derived = record ? this.#eventsOf(handle, record) : []
        if (events[index] && !derived.includes(events[index])) derived.push(events[index])
        // A copy of a copy: this record came from another space, and a removal
        // runs where the event was ingested, which is not here. The ancestor is
        // named so the caller can note the copy there too (0.11 review R3-S1).
        const origin = record && typeof record.fields === "object" && record.fields ? (isPlainObject(record.fields.copied_from) ? record.fields.copied_from : isPlainObject(record.fields.moved_from) ? record.fields.moved_from : null) : null
        if (origin && typeof origin.space === "string" && origin.space && origin.space !== this.#spaceId && RECORD_ID.test(String(origin.id ?? ""))) {
          const step = forwards.find((entry) => entry.space === origin.space)
          const copy = { record: origin.id, copy_id: copyId || null, origin_event: derived.find((event) => event) ?? null }
          if (step) step.copies.push(copy)
          else forwards.push({ space: origin.space, to_space: to, copies: [copy] })
        }
        for (const event of derived.length > 0 ? derived : [""]) {
          handle.run(
            "insert or replace into shared_copies (record_id, space, copy_id, at, event_id) values (?, ?, ?, ?, ?)",
            id,
            to,
            copyId.slice(0, 100),
            nowIso,
            event,
          )
        }
      }
      return { registered: ids.length, to_space: to, ...(forwards.length > 0 ? { forward: forwards } : {}) }
    })
  }

  /**
   * records.copies (slice 25, SPEC-3 §2.5 and G7): the origin's
   * `shared_copies` notes for one record, read back. A copy into a space the
   * caller may read (`actor.readableSpaces`, from the gateway's control
   * context) is named with its copy id; one into any other space is only
   * counted, with no id and no name: that space is another person's data.
   * Without a readable list every copy is counted, never named.
   */
  async copies(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "records.copies")
    const handle = this.#reader()
    let record = null
    if (body.id !== undefined) record = this.#load(handle, requireId(body.id))
    else if (body.path !== undefined) record = this.#loadByPath(handle, checkPath(body.path))
    else throw invalid("invalid_request", "records.copies needs an id or a path.", 'Send {id: "rec_…"} or {path: "people/ama"}.')
    if (!record || !visibleRecord(a, record)) throw notFound(`No record ${body.id ?? body.path} in this space.`, "Check it with records.get.")
    const readable = new Set(a.readableSpaces ?? [])
    const rows = handle.all("select space, copy_id, at from shared_copies where record_id = ? order by at desc, space", record.id)
    const copies = []
    let hidden = 0
    for (const row of rows) {
      const space = String(row.space ?? "")
      const copyId = String(row.copy_id ?? "")
      if (space && readable.has(space)) copies.push({ space, id: copyId || null, at: row.at ?? null })
      else hidden += 1
    }
    return { copies, hidden, total: rows.length }
  }

  /**
   * The lines of a page that Memory itself wrote (0.11 review R3-B2): the store
   * records who wrote each version, so authorship is read per line, not from the
   * page's own author. A line the person appended afterwards is not in any
   * version Memory wrote, so it is the person's — even on the routines' journal.
   *
   * @returns {Set<string>|null}
   */
  #memoryLines(handle, record) {
    if (record.kind !== "page") return null
    // A line is Memory's when the earliest state that held it — a stored
    // version, or the row itself — was written by the routines (0.11 review
    // R4-B3). A rewrite by the routine is still the routines'.
    const owners = new Map()
    const states = handle
      .all("select version, snapshot from versions where record_id = ? order by version", record.id)
      .map((row) => {
        try {
          return JSON.parse(row.snapshot)
        } catch {
          return null
        }
      })
      .filter(Boolean)
    states.push(record)
    for (const state of states) {
      const author = state?.change?.by?.user ?? null
      for (const line of String(state?.body ?? "").split("\n")) if (!owners.has(line)) owners.set(line, author)
    }
    return new Set([...owners].filter(([, author]) => author === ROUTINE_USER).map(([line]) => line))
  }

  /** Every event a record derives from: a `source` edge, a cited field, or a body citation. */
  #eventsOf(handle, record) {
    const events = new Set(citeEventsOf(record))
    for (const row of handle.all("select dst from links where src = ? and type = 'source'", record.id)) events.add(String(row.dst))
    return [...events].filter((event) => /^evt_[A-Za-z0-9]{1,64}$/.test(event))
  }

  /** events.cursor: where collection from a source stands. */
  async eventsCursor(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reading a source's cursor needs a role in this space")
    const { source, account } = this.#sourceKey(requireObject(input, "events.cursor"))
    const row = this.#reader().get("select * from sources where source = ? and account = ?", source, account)
    if (!row) throw notFound(`${source} (${account}) is not bound to this space.`, `Bind it with sources.bind after the person confirms the owner.`)
    const day = this.#nowIso().slice(0, 10)
    const reader = this.#reader()
    const resync = reader.get("select 1 as used from binding_resyncs where source = ? and account = ? and day = ?", source, account, day)
    // The scope the person confirmed travels with every read: without it a
    // scoped source reads its plugin's whole option and its page is refused.
    const consent = reader.get("select state, scope_json, digest from plugin_consents where source = ? and account = ?", source, account)
    const scope = consent ? parse(consent.scope_json, {}) : {}
    // A consent that is not `on` — `paused`, or `package_changed` once the
    // descriptor's hash changed — is what the binding stands at: the collector
    // reads nothing until the person confirms it again (§8.3.4; §3.3 rule 6).
    const status = consent && consent.state !== "on" ? consent.state : row.status
    // The owner the binding was confirmed for: every page's own `owner` is
    // compared with it, and a different one is a rebind, never a silent read (§15.3).
    const owner = { id: row.owner_id, label: row.owner_label ?? row.owner_id }
    // The digest the person confirmed: a read carries it to the source's host, which refuses another declaration
    // rather than serving a read under one nobody confirmed (B4).
    // The history anchor (lane 0195): the start of the window the person agreed to read, returned only while no cursor is saved, so a
    // resumed read is by its cursor alone and a collector that wakes late does not move the window.
    const firstSince = !row.cursor && typeof row.first_since === "string" && row.first_since ? row.first_since : null
    return { cursor: row.cursor ?? null, cursor_at: row.cursor_at ?? null, ...(firstSince ? { first_since: firstSince } : {}), enabled: Boolean(row.enabled), status, scope, owner, digest: consent?.digest ?? null, resync_today: Boolean(resync) }
  }

  /**
   * The latest arrival per UTC day of occurrence, for the routines' day queue
   * (FINDINGS R6): one row per day, `{day, at}`, where `at` is the newest
   * `ingested_at` of an event that day. A day whose `at` is after its last run
   * has an event the run never saw, so the day is due again. No text, no
   * owner's data: a date and a timestamp.
   */
  async ingestMarks(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "owner", "Reading when events arrived is for the space's owner (and its routines)")
    const body = requireObject(input, "events.ingestMarks")
    const since = body.since === undefined || body.since === null ? null : new Date(String(body.since).length === 10 ? `${body.since}T00:00:00Z` : body.since).toISOString()
    const until = body.until === undefined || body.until === null ? null : new Date(String(body.until).length === 10 ? `${body.until}T00:00:00Z` : body.until).toISOString()
    const where = ["ingested_at >= ?"]
    const params = [new Date(this.#settings.now().getTime() - this.#settings.eventRetentionDays * 86_400_000).toISOString()]
    if (since) {
      where.push("ingested_at >= ?")
      params.push(since)
    }
    if (until) {
      where.push("occurred_at < ?")
      params.push(until)
    }
    // **History is not a late arrival** (lane 0195b): a page read from a bind's anchor or an import arrives now and occurred weeks ago,
    // and the routine's day queue re-reads a past day whose newest arrival is after its last run. Only such a page is marked, by the
    // `since` the read carried — never by a time rule, which would hide a genuine late arrival (the gap catch-up's own case).
    const rows = this.#reader().all(
      `select substr(occurred_at, 1, 10) as day, max(ingested_at) as at
       from events
       where ${where.join(" and ")} and coalesce(history, 0) = 0
       group by day order by day`,
      ...params,
    )
    return { marks: rows.map((row) => ({ day: row.day, at: row.at })) }
  }

  /** events.list: oldest first, for the routines; the space's owner only. */
  async listEvents(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "owner", "Reading raw events is for the space's owner (and its routines) only")
    const body = requireObject(input, "events.list")
    const limit = intInRange(body.limit, "limit", 1, 500, 100)
    const where = ["ingested_at >= ?"]
    const params = [new Date(this.#settings.now().getTime() - this.#settings.eventRetentionDays * 86_400_000).toISOString()]
    for (const [key, op] of [
      ["since", ">="],
      ["until", "<"],
    ]) {
      if (body[key] === undefined || body[key] === null) continue
      if (!isDateOrDateTime(body[key])) throw invalid("invalid_request", `${key} must be a date or a date-time.`, "Send it as 2026-11-08 or 2026-11-08T00:00:00Z.")
      where.push(`occurred_at ${op} ?`)
      params.push(new Date(body[key].length === 10 ? `${body[key]}T00:00:00Z` : body[key]).toISOString())
    }
    // The arrival window, not the occurrence window: a late event is activity
    // even when it happened before the last run (daily-yield FINDINGS R6).
    if (body.ingested_after !== undefined && body.ingested_after !== null) {
      if (!isDateOrDateTime(body.ingested_after)) throw invalid("invalid_request", "ingested_after must be a date or a date-time.", "Send it as 2026-11-08T18:00:00Z.")
      where.push("ingested_at > ?")
      params.push(new Date(body.ingested_after.length === 10 ? `${body.ingested_after}T00:00:00Z` : body.ingested_after).toISOString())
    }
    if (body.source !== undefined) {
      const { source } = this.#sourceKey({ source: body.source })
      where.push("source = ?")
      params.push(source)
    }
    // The routines' "is anything new?" probe (lane 0198, review): history an
    // anchor or an import delivered arrived now but is not this day's work
    // (lane 0195b), so it is never activity. Additive: a caller that omits it
    // reads every row, as before.
    if (body.exclude_history !== undefined && typeof body.exclude_history !== "boolean") {
      throw invalid("invalid_request", "exclude_history must be true or false.", "Send exclude_history: true to leave imported history out.")
    }
    if (body.exclude_history === true) where.push("coalesce(history, 0) = 0")
    // Newest first (0.11, the console's Collected page): the same rows, read
    // from the other end, with a backward cursor. Additive: the routines' call
    // has no `newest_first` and reads oldest first, as before.
    const newestFirst = body.newest_first
    if (newestFirst !== undefined && typeof newestFirst !== "boolean") {
      throw invalid("invalid_request", "newest_first must be true or false.", "Send newest_first: true to read the newest first.")
    }
    // A window counted by source (lane 0197): the Collected page names the
    // source whose far-future instances it does not show, rather than a bare
    // total. Additive: a caller that does not ask keeps the same answer.
    if (body.count_sources !== undefined && typeof body.count_sources !== "boolean") {
      throw invalid("invalid_request", "count_sources must be true or false.", "Send count_sources: true to count the window by source.")
    }
    // The window's count, before the cursor narrows it: a page can say "of 1,240".
    const filters = where.join(" and ")
    const filterParams = [...params]
    const windowTotal = Number(this.#reader().get(`select count(*) as n from events where ${filters}`, ...filterParams)?.n) || 0
    const cursor = decodeCursor(body.cursor, 2)
    if (cursor) {
      where.push(newestFirst ? "(occurred_at < ? or (occurred_at = ? and id < ?))" : "(occurred_at > ? or (occurred_at = ? and id > ?))")
      params.push(cursor[0], cursor[0], cursor[1])
    }
    // A session capture owns is curated from its L0 turns, never from History's
    // events: skipped here, at read time, and counted (B8). Nothing is deleted,
    // so the skip is reversible and the transcript stays. The skip is part of
    // the page's own query, so `limit + 1` counts the rows a reader may see and
    // the cursor still says when there is a next page (0158's L). The window's
    // own count above keeps every row: `total` subtracts the skip itself.
    const skipClause = "(session_id is null or session_id not in (select session_id from sessions_seen where first_side = 'capture'))"
    // The window's rows per source, over the same filters and with the same
    // capture-session skip the page applies: the counts and the rows agree.
    const sourceCounts = body.count_sources === true
      ? this.#reader()
          .all(`select source, count(*) as n from events where ${filters}${body.include_skipped === true ? "" : ` and ${skipClause}`} group by source order by n desc, source`, ...filterParams)
          .map((row) => ({ source: row.source, count: Number(row.n) || 0 }))
      : null
    const pageWhere = body.include_skipped === true ? where.join(" and ") : `${where.join(" and ")} and ${skipClause}`
    const order = newestFirst ? "occurred_at desc, id desc" : "occurred_at, id"
    const rows = this.#reader().all(`select * from events where ${pageWhere} order by ${order} limit ?`, ...params, limit + 1)
    const skipped = this.#reader().get("select count(*) as n from events where session_id is not null and session_id in (select session_id from sessions_seen where first_side = 'capture')")
    const page = rows.slice(0, limit).map((row) => ({
      id: row.id,
      source: row.source,
      // A page read from a history anchor or an import (lane 0195b): the routine never journals it as a day's work. Absent on every other
      // row, so a v0.2 page's answer is the shape it always was.
      ...(Number(row.history) === 1 ? { history: true } : {}),
      account: row.account,
      external_id: row.external_id,
      kind: row.kind,
      occurred_at: row.occurred_at,
      thread: row.thread ?? null,
      actors: parse(row.actors, []),
      title: row.title ?? null,
      text: row.text ?? null,
      url: row.url ?? null,
      labels: parse(row.labels, []),
      hash: row.hash,
      ingested_at: row.ingested_at,
      session_id: row.session_id ?? null,
      removed_at: row.removed_at ?? null,
      // The source contract's v0.3.0 event metadata (#46 §2, §3), when the page
      // carried any: a v0.2 row adds no key here, so its answer is as it was.
      // A removed row answers none of it, whatever an older build left there.
      ...(row.meta && !row.removed_at ? parse(row.meta, {}) : {}),
    }))
    const last = page.at(-1)
    // Counted, never curated: how many events this space's read leaves to capture.
    const skippedInWindow = body.include_skipped === true
      ? 0
      : Number(this.#reader().get("select count(*) as n from events where " + filters + " and session_id is not null and session_id in (select session_id from sessions_seen where first_side = 'capture')", ...filterParams)?.n) || 0
    return {
      events: page,
      cursor: rows.length > limit && last ? encodeCursor([last.occurred_at, last.id]) : null,
      total: Math.max(0, windowTotal - skippedInWindow),
      session_skipped: Number(skipped?.n) || 0,
      ...(sourceCounts ? { source_counts: sourceCounts } : {}),
    }
  }

  /**
   * events.forget: delete events by source, account and age, or one event at a
   * time by its ref (design §8.5). A per-item forget writes a keyed-hash ref
   * tombstone, so neither the event nor a claim derived from it comes back: a
   * re-sync of the same item is refused, and a routine may not cite it.
   */
  async forgetEvents(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Forgetting events needs the editor role in this space")
    const body = requireObject(input, "events.forget")
    const items = body.items === undefined ? null : stringList(body.items, "items", null, 500)
    if (items && items.some((ref) => ref.length > 300)) {
      throw invalid("invalid_request", "items names events by their ref, at most 300 characters each.", "Send the ids a person asked to forget.")
    }
    if (items && (body.source !== undefined || body.account !== undefined || body.before !== undefined)) {
      throw invalid("invalid_request", "items names events one at a time; source, account and before do not combine with it.", "Send either items, or a source, account and age.")
    }
    const where = []
    const params = []
    if (body.source !== undefined) {
      const key = this.#sourceKey({ source: body.source, account: body.account })
      where.push("source = ?")
      params.push(key.source)
      if (body.account !== undefined) {
        where.push("account = ?")
        params.push(key.account)
      }
    } else if (body.account !== undefined) {
      throw invalid("invalid_request", "account needs a source.", "Send {source, account}.")
    }
    if (body.before !== undefined) {
      if (!isDateOrDateTime(body.before)) throw invalid("invalid_request", "before must be a date or a date-time.", "Send it as 2026-11-08.")
      where.push("occurred_at < ?")
      params.push(new Date(body.before.length === 10 ? `${body.before}T00:00:00Z` : body.before).toISOString())
    }
    // The whole forget holds the space from here to its last use of the handle:
    // its cascade awaits, and its transaction runs after it (review M5).
    const held = this.#settings.acquireSpace?.(this.#spaceId)
    try {
      const handle = this.#existing(a)
      if (!handle) return items ? { deleted: 0, tombstoned: 0 } : { deleted: 0 }
      if (items) {
        const now = this.#nowIso()
        handle.tx(() => this.#invalidateSilver(handle, { refs: items }))
        // S2's cascade first, in its own transactions and yielding between slices:
        // a claim that cited a forgotten item is removed, or has the item dropped
        // from it, so nothing the log says about the item survives the forget. The
        // switch is the space's own: with it off this is `{skipped: "off"}`, and a
        // forget is exactly what it was.
        // The cascade is awaited, and the handle is used again after it.
        await drainForget(handle, { refs: items }, { env: process.env })
        const answer = handle.tx(() => {
          let deleted = 0
          // The marks of the units these events were in go with them, before the
          // delete reads them (lane 0134, L), and so do the gate's verdicts on
          // what they carried (lane 0198, review L).
          this.#dropMarksOf(handle, `where id in (${items.map(() => "?").join(", ")})`, items)
          this.#dropTraitReadsOf(handle, `where id in (${items.map(() => "?").join(", ")})`, items)
          for (const ref of items) {
            deleted += Number(handle.run("delete from events where id = ?", ref).changes) || 0
            // A claim waiting on the trait classifier cites it: it goes too. And a
            // retry row is about the event alone, so it goes with it (review M2).
            handle.run("delete from trait_holds where ref = ?", ref)
            handle.run("delete from lane_retry where event_id = ?", ref)
          }
          const tombstoned = this.#refTombstones(handle, items, now, "gone")
          return { deleted, tombstoned }
        })
        return { ...answer, erase: this.#eraseFile() }
      }
      const result = handle.tx(() => {
        this.#invalidateSilver(handle, {
          ...(body.source ? { identity: { source: body.source, ...(body.account === undefined ? {} : { account: body.account }) } } : { all: true }),
          ...(body.before ? { before: body.before.length === 10 ? `${body.before}T00:00:00Z` : body.before } : {}),
        })
        // The marks of the units these events were in go with them, so the same
        // ids collected again are read (lane 0134, L), and the gate's verdicts on
        // what they carried go too (lane 0198, review L).
        const scope = where.length ? `where ${where.join(" and ")}` : ""
        this.#dropMarksOf(handle, scope, params)
        this.#dropTraitReadsOf(handle, scope, params)
        // Their retry rows go with them, in this transaction (review M2).
        handle.run(`delete from lane_retry where event_id in (select id from events ${scope})`, ...params)
        return handle.run(`delete from events ${scope}`, ...params)
      })
      return { deleted: Number(result.changes), erase: this.#eraseFile() }
    } finally {
      held?.release()
    }
  }

  /** sources.list */
  async listSources(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Listing sources needs a role in this space")
    requireObject(input, "sources.list")
    const handle = this.#reader()
    const counts = new Map(
      handle.all("select source, account, count(*) as n from events group by source, account").map((row) => [`${row.source}\u0000${row.account}`, Number(row.n)]),
    )
    const collections = new Map(handle.all("select * from source_collections").map((row) => [`${row.source}\u0000${row.account}`, row]))
    // What kind each bound source is, from its plugin's declaration (review S4):
    // a snapshot binding made before G1 is marked on its row, never left looking
    // like a source that collects.
    const kinds = new Map(handle.all("select * from sources").map((row) => [row.source, declaredKind(handle, row.source)]))
    // A refused event is visible where its source is (DESIGN §2.3.1): the
    // count, the newest one's id, and why it was refused. Ids only, from the
    // audit the page wrote; nothing of the refused event's text is here.
    // How many of each binding's removals wait for a tick (R6-S2).
    const retractions = new Map(
      handle.all("select source, account, count(*) as n from events where retract_pending = 1 group by source, account").map((row) => [`${row.source}\u0000${row.account}`, Number(row.n)]),
    )
    const refusals = new Map(
      handle
        .all(
          `select r.source, r.account, g.n as count, r.at, r.external_id, r.kind, r.reason
           from event_refusals r
           join (select source, account, count(*) as n, max(seq) as newest from event_refusals group by source, account) g
             on g.source = r.source and g.account = r.account and g.newest = r.seq`,
        )
        .map((row) => [`${row.source}\u0000${row.account}`, row]),
    )
    return {
      sources: handle.all("select * from sources order by source, account").map((row) => this.#sourceRow(row, counts, collections, refusals, retractions, kinds)),
      requests: handle.all("select * from source_requests order by source, account").map((row) => this.#requestRow(row)),
    }
  }

  #requestRow(row) {
    return {
      source: row.source,
      account: row.account,
      state: row.state,
      requested_by: row.requested_by,
      requested_at: row.requested_at,
      ...parse(row.request, {}),
      // The window Memory would also read at the bind (lane 0195), so the dialog can name it.
      history: requestHistory(row.source),
      owner: row.owner_id ? { id: row.owner_id, label: row.owner_label ?? row.owner_id } : null,
      reported_account: row.reported_account ?? null,
      reported_at: row.reported_at ?? null,
      // As the collection's error: a 0.9.x row holds the plugin's own sentence
      // raw, and `sources.list` is where the console reads it (round 2).
      note: row.note ? errorText(row.note, 500) : null,
      failures: Number(row.failures) || 0,
      retry_at: row.retry_at ?? null,
    }
  }

  /**
   * Bind requests, their reports and their confirmation are the person's own:
   * only in their personal space, as its owner. A team space's editor cannot
   * ask for, or report, a source that would collect into the team's memory.
   */
  #ownPersonalSpace(a, handle, what) {
    const owner = handle?.meta?.owner_user
    if (a.spaceKind !== "personal" || a.role !== "owner" || (owner && owner !== a.user)) {
      throw new RecordsError(403, "personal_space_only", `${what} only in your own personal space.`, "Ask from your personal space: sources collect into the memory of the person whose account they read.")
    }
  }

  /** A request's optional stream selection: short names, at most 32; null when absent. */
  #streams(value) {
    if (value === undefined || value === null) return null
    if (!Array.isArray(value) || value.length > 32 || !value.every((name) => typeof name === "string" && /^[a-z][a-z0-9_.:-]{0,63}$/.test(name))) {
      throw invalid("invalid_source", "streams must be a list of at most 32 short lowercase names.", "Send the stream names the source offers, or leave streams out for its default.")
    }
    return [...new Set(value)]
  }

  /**
   * sources.request: the person asks to collect from a source. Nothing is read
   * here: the person's collector sees the request, reads only this source's
   * signed-in account, and reports it (sources.report) for the person to
   * confirm with sources.bind. A repeat restarts the request.
   */
  async requestSource(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Asking to collect from a source needs the editor role in this space")
    const body = requireObject(input, "sources.request")
    const { source, account } = this.#sourceKey(body)
    const streams = this.#streams(body.streams)
    this.#ownPersonalSpace(a, null, "A source is bound")
    const handle = this.#writer(a)
    this.#ownPersonalSpace(a, handle, "A source is bound")
    // C1: a source an installed plugin declares is refused here, never rerouted
    // into a consent the person was never shown (see pluginConsent.declaredSourceRefusal).
    const declared = pluginConsent.declaredSourceRefusal(handle, { source })
    if (declared) throw conflict(declared.code, declared.message, declared.next)
    const problem = bindingProblem(handle, { source, account })
    if (problem) throw conflict(problem.code, problem.message, problem.next)
    const bound = handle.get("select status, enabled from sources where source = ? and account = ?", source, account)
    if (bound?.status === "confirmed" && bound.enabled) {
      throw conflict("already_bound", `${source} (${account}) is already collecting in this space.`, "Unbind it first to change the account.")
    }
    const nowIso = this.#nowIso()
    const row = handle.tx(() => {
      handle.run(
        `insert into source_requests (source, account, requested_by, requested_at, request, state, owner_id, owner_label, reported_account, reported_at, note)
         values (?, ?, ?, ?, ?, 'requested', null, null, null, null, null)
         on conflict(source, account) do update set requested_by = excluded.requested_by, requested_at = excluded.requested_at, request = excluded.request,
           state = 'requested', owner_id = null, owner_label = null, reported_account = null, reported_at = null, note = null, failures = 0, retry_at = null`,
        source,
        account,
        a.user,
        nowIso,
        JSON.stringify(streams ? { streams } : {}),
      )
      return handle.get("select * from source_requests where source = ? and account = ?", source, account)
    })
    return { request: this.#requestRow(row) }
  }

  /**
   * sources.report: the collector's answer to a request: the account the
   * source says is signed in (state `reported`), or why it could not tell
   * (`failed`, with the source's own words in `note`). Only a request the
   * person made can be reported on; nothing is bound here.
   */
  async reportSource(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Reporting a source's account needs the editor role in this space")
    const body = requireObject(input, "sources.report")
    const { source, account } = this.#sourceKey(body)
    const owner = body.owner === undefined || body.owner === null ? null : this.#owner(body.owner)
    const reported = body.reported_account === undefined || body.reported_account === null ? null : this.#sourceKey({ source, account: body.reported_account }).account
    const note = body.note === undefined || body.note === null ? null : errorText(String(body.note), 500)
    this.#ownPersonalSpace(a, null, "A source's account is reported")
    const handle = this.#existing(a)
    this.#ownPersonalSpace(a, handle, "A source's account is reported")
    const row = handle?.get("select * from source_requests where source = ? and account = ?", source, account)
    if (!row) throw notFound(`Nobody asked to collect from ${source} (${account}) in this space.`, "Report only on a request sources.list returns.")
    if (row.requested_by !== a.user) throw forbidden("Only the person who asked can report on this request.", "The person's own collector reports on their requests.")
    const nowMs = this.#settings.now().getTime()
    const nowIso = new Date(nowMs).toISOString()
    // A failure backs off (1 h, then 6 h); the third needs the person's attention, and nothing asks again until Bind… again.
    const failures = owner ? 0 : (Number(row.failures) || 0) + 1
    const state = owner ? "reported" : failures >= REQUEST_MAX_FAILURES ? "attention" : "failed"
    const retryAt = state === "failed" ? new Date(nowMs + REQUEST_BACKOFF_MS[failures - 1]).toISOString() : null
    const after = handle.tx(() => {
      handle.run(
        "update source_requests set state = ?, owner_id = ?, owner_label = ?, reported_account = ?, reported_at = ?, note = ?, failures = ?, retry_at = ? where source = ? and account = ?",
        state,
        owner?.id ?? null,
        owner?.label ?? null,
        owner ? (reported ?? account) : null,
        nowIso,
        note,
        failures,
        retryAt,
        source,
        account,
      )
      return handle.get("select * from source_requests where source = ? and account = ?", source, account)
    })
    return { request: this.#requestRow(after) }
  }

  /** sources.cancel: drop a bind request; nothing was collected, so nothing else changes. */
  async cancelSourceRequest(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Cancelling a source request needs the editor role in this space")
    const { source, account } = this.#sourceKey(requireObject(input, "sources.cancel"))
    // 0.9.7: a request is the person's own, so only they cancel it, in their personal space.
    this.#ownPersonalSpace(a, null, "A source request is cancelled")
    const handle = this.#existing(a)
    this.#ownPersonalSpace(a, handle, "A source request is cancelled")
    if (!handle) return { cancelled: false }
    const result = handle.tx(() => handle.run("delete from source_requests where source = ? and account = ?", source, account))
    return { cancelled: Number(result.changes) > 0 }
  }

  /**
   * sources.bind: the person's confirmation of whose account a source collects.
   *
   * 0.9.7 (owner decision D1, audit records #1): the confirmation is enforced
   * here, not by a plugin's `ask` rule. A bind needs all of:
   * - the caller's own personal space, as its owner (`personal_space_only`);
   * - a browser session of Memory's console (`session_required`): the gateway
   *   sets `x-records-credential: session` only after its cookie, CSRF and
   *   Origin checks, so no API key, connect token or agent credential binds;
   * - a request the caller made (`sources.request`) that their collector
   *   answered (`reported`), for this source and account (`source_not_reported`);
   * - the owner that request reported (`owner_mismatch`).
   * The binding takes the owner from the request, never from the body.
   */
  async bindSource(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Binding a source needs the editor role in this space")
    const body = requireObject(input, "sources.bind")
    const { source, account } = this.#sourceKey(body)
    const owner = this.#owner(body.owner)
    if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw invalid("invalid_source", "enabled is true or false.", "Send enabled: true to collect.")
    const enabled = body.enabled === false ? 0 : 1
    // The days of history the person agreed to read (lane 0195): refused before anything is written.
    const lookback = chosenHistoryDays(body.lookback_days, source)
    this.#ownPersonalSpace(a, null, "A source is bound")
    if (a.credential !== "session") {
      throw new RecordsError(
        403,
        "session_required",
        "Confirming whose account Memory collects is done by the person in a browser, in Memory's console (Sources), not with a key or an agent's token.",
        "Open Memory's console, Sources, and choose Confirm for this source. Ask for it there with Bind… if it is not listed.",
      )
    }
    const handle = this.#existing(a)
    this.#ownPersonalSpace(a, handle, "A source is bound")
    // C1: refused here too, before anything is written. A legacy bind of a declared
    // source made a confirmed row with no consent, which ingest then refused - a
    // dead end with no way forward for the person.
    if (handle) {
      const declared = pluginConsent.declaredSourceRefusal(handle, { source })
      if (declared) throw conflict(declared.code, declared.message, declared.next)
    }
    const request = handle?.get(
      "select * from source_requests where source = ? and state = 'reported' and owner_id is not null and coalesce(reported_account, account) = ?",
      source,
      account,
    )
    if (!request) {
      throw conflict(
        "source_not_reported",
        `Nobody's collector has reported which account ${source} (${account}) is signed in to, so there is nothing to confirm.`,
        "Choose Bind… for this source in Memory's console; your collector reports the account on its next run, then Confirm it.",
      )
    }
    if (request.requested_by !== a.user) throw forbidden("Only the person who asked to collect from this source can confirm it.", "Ask from your own personal space with Bind…, then confirm the account your collector reports.")
    // **The binding takes the account its collector reported** (G2), not the one
    // the person asked with: a source that reads one account answers its own name
    // (`history.sessions` answers the machine it indexed, `linear.activity` a
    // workspace user), and Memory reads it back against that account.
    const bindingAccount = typeof request.reported_account === "string" && request.reported_account !== "" ? request.reported_account : account
    if (handle) {
      // The one bind rule, at the confirm as at the request (round 2, R2-2), and
      // on the account this confirm will **store** (review S2): a legacy bind
      // whose probe reports another account is the same account as an existing
      // declared binding under that name, so checking the asked one would miss it.
      const problem = bindingProblem(handle, { source, account: bindingAccount })
      if (problem) throw conflict(problem.code, problem.message, problem.next)
    }
    if (request.owner_id !== owner.id) {
      throw new RecordsError(
        403,
        "owner_mismatch",
        `${source} (${account}) reported ${request.owner_label ?? request.owner_id}, not ${owner.label}: a bind confirms only the account the collector reported.`,
        "Reload Sources in Memory's console and confirm the account it shows.",
      )
    }
    const nowIso = this.#nowIso()
    const row = handle.tx(() => {
      // **A legacy bind that re-keys the account supersedes the binding it
      // replaces, and only that one** (review R2-a, then L1): as the declared
      // path matches its consent's `asked_account`, this matches the account the
      // replaced binding was asked with. The same source answering another
      // account (an X handle switch on a build that does not yet declare
      // `sources`) stops the binding the person asked for the same way; a second
      // account they named themselves is asked with another account and is never
      // stopped by this one. Its records stay either way.
      if (bindingAccount !== request.account) {
        // A row made before the column (0.9.14, or any build before it) has no
        // asked account (review L4-1). For a source that reads **one** account
        // there is only one account to switch from, so any ask supersedes it; for
        // a source with **named** accounts an unknown row may be another alias's,
        // so it is left collecting and marked on its row instead.
        const unknownCounts = legacyNamed(source) ? 0 : 1
        handle.run(
          "update sources set status = 'superseded', enabled = 0, updated = ? where source = ? and account <> ? and status = 'confirmed' and (asked_account = ? or (asked_account is null and ? = 1))",
          nowIso,
          source,
          bindingAccount,
          request.account,
          unknownCounts,
        )
      }
      handle.run(
        `insert into sources (source, account, owner_id, owner_label, status, confirmed_at, enabled, created, updated, asked_account)
         values (?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?)
         on conflict(source, account) do update set owner_id = excluded.owner_id, owner_label = excluded.owner_label,
           status = 'confirmed', confirmed_at = excluded.confirmed_at, enabled = excluded.enabled, updated = excluded.updated,
           asked_account = excluded.asked_account`,
        source,
        bindingAccount,
        request.owner_id,
        request.owner_label ?? request.owner_id,
        nowIso,
        enabled,
        nowIso,
        nowIso,
        // The account the person asked with, which the request row holds: what a
        // later re-key is matched against (review L1).
        request.account,
      )
      // The history the person agreed to read, anchored on the binding (lane 0195).
      anchorBinding(handle, { source, account: bindingAccount, nowIso, days: lookback })
      // A bind answers the person's request.
      handle.run("delete from source_requests where source = ? and (account = ? or reported_account = ?)", source, bindingAccount, bindingAccount)
      // What counts as the person's own mail just changed: the lane rule's
      // cached person is stale from here (review M4).
      this.#forgetIngestPerson(handle)
      return handle.get("select * from sources where source = ? and account = ?", source, bindingAccount)
    })
    return { source: this.#sourceRow(row) }
  }

  /**
   * sources.import (lane 0195): read the last N days of a binding made before
   * history import existed, once. It is a bind's own act: the person's browser
   * session, in their own personal space, as an editor. In one transaction it sets
   * the binding's anchor and clears its saved cursor, so the next collection reads
   * from `since`; `confirmed_at` is untouched (the engine routes by it), and what
   * the read brings again is dropped by `events.ingest`, as a re-sync's is.
   */
  async importHistory(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Importing a source's history needs the editor role in this space")
    const body = requireObject(input, "sources.import")
    const { source, account } = this.#sourceKey(body)
    this.#ownPersonalSpace(a, null, "A source's history is imported")
    if (a.credential !== "session") throw pluginConsent.sessionRequired("Importing a source's history")
    const handle = this.#writer(a)
    this.#ownPersonalSpace(a, handle, "A source's history is imported")
    const nowIso = this.#nowIso()
    return handle.tx(() => importHistory({ handle, nowIso }, { source, account }, body.days))
  }

  /** sources.unbind: stop collection and delete the source's events. */
  async unbindSource(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Unbinding a source needs the editor role in this space")
    const { source, account } = this.#sourceKey(requireObject(input, "sources.unbind"))
    const handle = this.#existing(a)
    const row = handle?.get("select 1 from sources where source = ? and account = ?", source, account)
    if (!row) throw notFound(`${source} (${account}) is not bound to this space.`, "List the bound sources with sources.list.")
    const waiting = Number(handle.get("select count(*) as n from events where source = ? and account = ? and retract_pending = 1", source, account)?.n ?? 0)
    if (waiting > 0) {
      // Deleting the events would delete their flags with them, and the records
      // that still quote the files would keep the quotes for good (R6-S3).
      throw conflict(
        "retractions_pending",
        `${source} (${account}) is still retracting ${waiting} removed ${waiting === 1 ? "file" : "files"}; its events cannot be deleted yet.`,
        "Nothing was unbound and nothing was lost: the removals finish in the next few collector ticks. Try again shortly.",
      )
    }
    const answer = handle.tx(() => {
      this.#invalidateSilver(handle, { identity: { source, account } })
      // Its units' read marks go with its events: the same ids collected again
      // after a rebind are read, not skipped as already read (lane 0134, L), and
      // so do the gate's verdicts on what they carried (lane 0198, review L).
      this.#dropMarksOf(handle, "where source = ? and account = ?", [source, account])
      this.#dropTraitReadsOf(handle, "where source = ? and account = ?", [source, account])
      const deleted = Number(handle.run("delete from events where source = ? and account = ?", source, account).changes)
      // The refusals of an unbound source are about events this binding no
      // longer has: they go with it, so Sources cannot show a stale count.
      handle.run("delete from event_refusals where source = ? and account = ?", source, account)
      handle.run("delete from sources where source = ? and account = ?", source, account)
      handle.run("delete from source_requests where source = ? and account = ?", source, account)
      handle.run("delete from source_collections where source = ? and account = ?", source, account)
      // The engine's cursor and retry rows for the binding go with it (S3a): a
      // rebind is a new consent, so its items are read from the beginning of its
      // own window, never from a cursor the previous binding left. The **ledger**
      // stays: it is what the cell spent, and an unbind does not un-spend it
      // (review L4). A person's erasure deletes it with their account.
      handle.run("delete from lane_cursors where source = ? and account = ?", source, account)
      handle.run("delete from lane_retry where source = ? and account = ?", source, account)
      this.#forgetIngestPerson(handle)
      return { deleted_events: deleted }
    })
    if (handle.erasePending && handle.file) this.#truncateWal(handle)
    return answer
  }

  /**
   * sources.collected: the person's collector reports how its last collection
   * from a bound source went (0.9.8): `ok`, and when it failed, a short
   * `error`. The console shows it on Sources. Only in the caller's own personal
   * space, as its owner (as sources.report), and only for a binding that
   * exists; nothing else changes, and no event is read or written.
   *
   * **A reason is one line, with its code** (0.12.3): a failure that arrives
   * as `{code, message}` — an older or another collector's report — is read
   * here as `CODE: message`, never `String(object)`, which is what Sources
   * showed as the whole of "Why: …".
   *
   * **A failure from another machine is not the binding failing** (0.12.3):
   * every report names the collector that made it (`host`). The row stands for
   * the collector that last succeeded for this binding, so a failure from
   * another machine leaves `ok` as it was and is kept beside it — named, timed
   * and redacted — for Sources to say so. A machine with no sign-in to the
   * source (a guest started from a snapshot) can then fail on every tick
   * without telling the person the binding they collect is broken.
   *
   * **A failure that names no machine is kept beside a named one** (0.14.0).
   * A collector too old to name itself can collect for the same person on its
   * own schedule, from another machine, and fail there every time. When the
   * standing row names a machine, that failure is kept beside it under the
   * fixed label `unnamed: an older Memory`, and the standing row — `ok`, `at`,
   * `error`, `accepted`, `failed_since`, `more`, `host` — is untouched. The
   * label holds a space and a capital, and `#host()` lower-cases every machine
   * name, so no machine name can equal it. Where nothing names a machine — no
   * row, or a row an old collector wrote — the failure is the binding's, as
   * before (0.12.3), and a second one keeps the first failure's time.
   */
  async noteCollection(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Reporting a collection needs the editor role in this space")
    const body = requireObject(input, "sources.collected")
    const { source, account } = this.#sourceKey(body)
    if (typeof body.ok !== "boolean") throw invalid("invalid_request", "ok must be true or false.", "Send {source, account, ok, error?}.")
    if (body.host !== undefined && body.host !== null && typeof body.host !== "string") throw invalid("invalid_request", "host must be text.", "Send the machine name, or leave it out.")
    // A skipped report says the collector read nothing from the binding, and
    // why. This release knows one reason, consent: it is a success that read
    // nothing, so it never carries a failure, and any other reason is refused
    // rather than guessed (console redesign §4.4).
    if (body.skipped !== undefined && body.skipped !== null && body.skipped !== "consent") throw invalid("invalid_request", "skipped must be \"consent\".", "Send skipped only when the binding was skipped for consent.")
    if (body.skipped === "consent" && body.ok !== true) throw invalid("invalid_request", "a skipped report is not a failure: ok must be true.", "Send ok: true with skipped: \"consent\".")
    const skipped = body.skipped === "consent" ? "consent" : null
    // A gap the plugin answered (lane 0195): `window-truncated` says it served less than the window asked. Shown on the source's card;
    // it is not a failure, and one that is not the contract's is dropped rather than stored.
    let gap = null
    try {
      gap = gapOf(body.gap)
    } catch {
      gap = null
    }
    const host = this.#host(body.host)
    // The `since` this run sent (lane 0195): the only evidence that a binding's history anchor was read. It is kept when a later
    // report names none, so a quiet run never un-reads the history; a value that is not a past date is refused.
    let sinceSent = null
    if (body.since !== undefined && body.since !== null) {
      const at = typeof body.since === "string" ? Date.parse(body.since) : Number.NaN
      if (!Number.isFinite(at) || at > this.#settings.now().getTime() + 60_000) {
        throw invalid("invalid_request", "since must be an ISO date-time in the past: the start of the window this run read.", "Send the since the read carried, or leave it out.")
      }
      sinceSent = new Date(at).toISOString()
    }
    const accepted = Number.isInteger(body.accepted) && body.accepted >= 0 ? body.accepted : null
    // Whether the run ended with more pages waiting (review S5): the console's
    // Sources row says "catching up" from it, so a person is never told a source
    // is quiet when it is still behind.
    const more = body.more === true
    const error = body.ok ? null : failureText(body.error ?? "the collection failed", 300)
    // As sources.report: only the person's own collector, in their own personal space (0.9.8 review).
    this.#ownPersonalSpace(a, null, "A collection is reported")
    this.#ownPersonalSpace(a, this.#existing(a), "A collection is reported")
    const handle = this.#writer(a)
    const nowIso = this.#nowIso()
    return handle.tx(() => {
      if (!handle.get("select 1 from sources where source = ? and account = ?", source, account)) {
        throw notFound(`${source} (${account}) is not bound to this space.`, "Report only a source sources.list names.")
      }
      const before = handle.get("select ok, failed_since, host, since_sent from source_collections where source = ? and account = ?", source, account)
      const standing = typeof before?.host === "string" && before.host ? before.host : null
      // Who this failure belongs to when it names no machine: the fixed label,
      // and only when a named machine stands. With no standing machine the
      // failure is the binding's, so nothing is kept beside it (0.14.0).
      const aside = host ?? (standing ? UNNAMED_COLLECTOR : null)
      if (!body.ok && standing && aside && standing !== aside) {
        // Another machine could not read it: the binding stays as the collector
        // that reads it left it, and this failure is kept beside it by name, or
        // under the label of a collector that names none.
        handle.run(
          "update source_collections set elsewhere_host = ?, elsewhere_at = ?, elsewhere_error = ? where source = ? and account = ?",
          aside,
          nowIso,
          error,
          source,
          account,
        )
        return { collection: this.#collectionRow(handle.get("select * from source_collections where source = ? and account = ?", source, account)) }
      }
      const failedSince = body.ok ? null : before && !before.ok && before.failed_since ? before.failed_since : nowIso
      // The skip's own moment goes with the flag: a row a 0.14.0 build wrote a
      // success over still carries the older skip, and only a skip from this
      // report is honoured (0153's L).
      const skippedAt = skipped ? nowIso : null
      handle.run(
        `insert into source_collections (source, account, at, ok, error, accepted, failed_since, more, host, skipped, skipped_at, gap_reason, gap_since, since_sent) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(source, account) do update set at = excluded.at, ok = excluded.ok, error = excluded.error, accepted = excluded.accepted, failed_since = excluded.failed_since, more = excluded.more, host = excluded.host, skipped = excluded.skipped, skipped_at = excluded.skipped_at, gap_reason = excluded.gap_reason, gap_since = excluded.gap_since, since_sent = coalesce(excluded.since_sent, source_collections.since_sent), elsewhere_host = null, elsewhere_at = null, elsewhere_error = null`,
        source,
        account,
        nowIso,
        body.ok ? 1 : 0,
        error,
        accepted,
        failedSince,
        more ? 1 : 0,
        host,
        skipped,
        skippedAt,
        gap?.reason ?? null,
        gap?.since ?? null,
        sinceSent ?? before?.since_sent ?? null,
      )
      return { collection: { at: nowIso, ok: body.ok, error, accepted, failed_since: failedSince, more, host, skipped, skipped_at: skippedAt, gap, since: sinceSent ?? before?.since_sent ?? null, elsewhere: null } }
    })
  }

  /**
   * Where history ends, for a page read from an anchor (lane 0195b, round 4): the start of the local day **before** the read's own day, in the
   * zone the routine journals in — the index page's `fields.tz`, else UTC, exactly as `spaceInfo` reads it. The routine writes today's and
   * yesterday's journals, so events from those two days are live; anything earlier is history.
   */
  #journalHistoryBefore(handle, now) {
    const index = handle.get("select fields from records where kind = 'page' and type = 'index' and path = 'index'")
    let fields = {}
    try {
      fields = parse(index?.fields ?? "{}", {})
    } catch {
      fields = {}
    }
    const tz = safeTz(fields?.tz ?? "UTC")
    return dayBounds(addDays(localDay(now, tz), -1), tz).start
  }

  /** A report's machine name: one line, at most 128 characters, comparable across reports. */
  #host(value) {
    if (value === undefined || value === null) return null
    const host = String(value).replace(/\s+/g, " ").trim().slice(0, 128).toLowerCase()
    return host || null
  }

  /**
   * A stored collection as Sources and Home read it: the standing report, the
   * other machine's failure beside it when there is one, redacted where it is
   * answered (a row an old build wrote holds the collector's own words raw).
   */
  #collectionRow(row) {
    if (!row) return null
    return {
      at: row.at,
      ok: Boolean(row.ok),
      error: row.error ? errorText(row.error, 300) : null,
      accepted: row.accepted ?? null,
      failed_since: row.failed_since ?? null,
      more: Boolean(row.more),
      // A skip is honoured only while it is this row's own report: 0.14.0's
      // upsert never cleared the column, so a rollback and an upgrade again can
      // leave an old skip beside a newer failure or a newer success. The skip's
      // moment must equal the row's `at`, and the row must have succeeded with
      // no error (the 0153 review's L1, and L).
      skipped: row.skipped === "consent" && row.skipped_at === row.at && Number(row.ok) === 1 && !row.error ? "consent" : null,
      host: row.host ?? null,
      // The gap the plugin answered on this collection (lane 0195): it served less than the window asked. Not a failure.
      gap: row.gap_reason ? { reason: row.gap_reason, since: row.gap_since ?? null } : null,
      // The last `since` a collection reported sending (lane 0195): what marks a history anchor read.
      since: row.since_sent ?? null,
      elsewhere: row.elsewhere_host
        ? { host: row.elsewhere_host, at: row.elsewhere_at ?? null, error: row.elsewhere_error ? errorText(row.elsewhere_error, 300) : null }
        : null,
    }
  }

  // -------------------------------------------------------------------------
  // plugins.* (DESIGN-PLUGIN-MEMORY §2.3 step 7, §3.2)

  /**
   * One reported plugin, checked field by field. A bad field throws a
   * PluginEntryError naming it, with the id when the id itself is good: that
   * plugin is then stored invalid on its own, and the rest of the report is
   * kept (review 1).
   */
  #pluginEntry(entry, index) {
    const where = `plugins[${index}]`
    let goodId = null
    const bad = (what) => Object.assign(new Error(`${where}: ${what}`), { pluginId: goodId })
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw bad("must be an object")
    const id = String(entry.id ?? "")
    if (!PLUGIN_ID.test(id)) throw bad("id must be a plugin id such as slack.workspace")
    goodId = id
    const text = (value, max, what) => {
      if (value === undefined || value === null) return null
      if (typeof value !== "string" || value.length > max) throw bad(`${what} must be text of at most ${max} characters`)
      return value.replace(/[\u0000-\u001f\u007f]/g, " ")
    }
    const source = entry.source
    if (!source || typeof source !== "object" || (source.kind !== "package" && source.kind !== "local")) throw bad("source.kind must be package or local")
    const ref = text(source.kind === "package" ? source.target : source.path, 1000, source.kind === "package" ? "source.target" : "source.path")
    if (!ref) throw bad(`source.${source.kind === "package" ? "target" : "path"} is required`)
    if (!PLUGIN_STATES.includes(entry.state)) throw bad(`state must be one of ${PLUGIN_STATES.join(", ")}`)
    const digest = entry.digest === undefined || entry.digest === null ? null : String(entry.digest)
    if (digest !== null && !/^sha256:[0-9a-f]{64}$/.test(digest)) throw bad("digest must be sha256:<hex>")
    // The current contract declares `sources`; the previous one a `memory` manifest.
    const contract = entry.contract === "sources" ? "sources" : "memory"
    if (contract === "sources" && (entry.descriptor === undefined || entry.descriptor === null)) throw bad("a sources plugin reports its descriptor")
    return {
      id,
      contract,
      packageName: text(entry.package, 214, "package"),
      sourceKind: source.kind,
      sourceRef: ref,
      version: text(entry.version, 100, "version"),
      digest,
      state: entry.state,
      reason: text(entry.reason, 300, "reason"),
      declares: entry.declares === true,
      manifest: entry.manifest,
      descriptor: contract === "sources" ? entry.descriptor : undefined,
    }
  }

  #pluginRow(row, nowMs) {
    const state = listedState(row, nowMs)
    return {
      id: row.plugin_id,
      package: row.package_name ?? null,
      source: row.source_kind === "local" ? { kind: "local", path: row.source_ref } : row.source_kind === "package" ? { kind: "package", target: row.source_ref } : { kind: "unknown" },
      version: row.version ?? null,
      digest: row.digest ?? null,
      namespace: row.namespace ?? null,
      state,
      reason: state === "missing" && row.state !== "missing" ? PLUGIN_MISSING : row.reason ?? null,
      edited: Boolean(row.edited),
      manifest: row.manifest_json ? parse(row.manifest_json, null) : null,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
    }
  }

  /**
   * plugins.report: the person's collector reports the plugins it discovered
   * (src/plugins/discovery.js). The service validates every declaration again
   * with the same frame (records/src/plugins/manifest.js) and recomputes its
   * digest; it records and classifies, and grants nothing.
   *
   * - Only in the caller's own personal space, as its owner (as sources.report).
   * - `available` or `conflict` needs a declaration that passes the frame and
   *   matches its digest; otherwise the row is `invalid`, without its text.
   * - A namespace two entries claim is a conflict for both.
   * - `unverified` is kept only for a plugin this space already knows, or one
   *   whose matching installs differ (it declares): a plugin that never
   *   declared is not shown.
   * - Rule 6: for a package plugin, the first digest seen at each version is
   *   kept; a different one at the same version marks the install edited.
   * - A bad entry does not refuse the report (review 1): with a good id it is
   *   stored `invalid` with the reason; without one, or a repeated id, it is
   *   answered in `refused`. Only a bad envelope is a 400.
   * - A report adds or refreshes the plugins it lists (`listed_at`) and never
   *   marks another plugin missing, `full` or not (lane 0188): it carries no id
   *   that tells one machine from another, so a second machine's report cannot
   *   say what the first one has. A plugin no report has listed for
   *   PLUGIN_MISSING_AFTER_MS reads `missing` (records/src/plugins/seen.js).
   *   `missing` is this service's own state; a report cannot claim it.
   */
  async reportPlugins(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Reporting plugins needs the editor role in this space")
    const body = requireObject(input, "plugins.report")
    if (typeof body.layout !== "boolean") throw invalid("invalid_request", "layout must be true or false.", "Send {layout, plugins}.")
    if (body.full !== undefined && typeof body.full !== "boolean") throw invalid("invalid_request", "full must be true or false.", "Send {layout, full, plugins}.")
    if (!Array.isArray(body.plugins) || body.plugins.length > MAX_REPORTED_PLUGINS) throw invalid("invalid_request", `plugins must be a list of at most ${MAX_REPORTED_PLUGINS}.`, "Send {layout, plugins}.")
    const entries = []
    const refused = []
    const seen = new Set()
    for (const [index, raw] of body.plugins.entries()) {
      let entry
      try {
        entry = this.#pluginEntry(raw, index)
      } catch (error) {
        if (!error.pluginId) {
          refused.push({ index, reason: error.message })
          continue
        }
        // A good id with a bad field: that plugin is invalid, on its own.
        entry = { id: error.pluginId, packageName: null, sourceKind: "unknown", sourceRef: "", version: null, digest: null, state: "invalid", reason: `the report for this plugin was malformed: ${error.message}`.slice(0, 300), declares: false, manifest: undefined }
      }
      if (seen.has(entry.id)) {
        refused.push({ index, reason: `plugins[${index}]: the plugin id ${entry.id} is reported twice` })
        continue
      }
      seen.add(entry.id)
      entries.push(entry)
    }
    this.#ownPersonalSpace(a, null, "Plugins are reported")
    const handle = this.#writer(a)
    this.#ownPersonalSpace(a, handle, "Plugins are reported")

    // Validate again: the report is a claim, the frame decides.
    for (const entry of entries) {
      entry.namespace = null
      if (entry.state !== "available" && entry.state !== "conflict") {
        entry.manifest = undefined
        continue
      }
      // The current contract: the descriptor is the declaration, and its hash
      // must be the one reported. Memory's own discovery validated the schema;
      // here the digest is the check that what was reported is what is installed.
      if (entry.contract === "sources") {
        let hash = null
        try {
          hash = descriptorHash(entry.descriptor)
        } catch {
          hash = null
        }
        if (hash === null || hash !== entry.digest) Object.assign(entry, { state: "invalid", reason: "the reported digest does not match the descriptor", manifest: undefined })
        else entry.manifest = { contract: "sources", descriptor: entry.descriptor, hash }
        continue
      }
      const checked = validateManifest(entry.manifest)
      if (!checked.ok) Object.assign(entry, { state: "invalid", reason: `the records service refused the declaration: ${checked.reason}`.slice(0, 300), manifest: undefined })
      else if (manifestDigest(entry.manifest) !== entry.digest) Object.assign(entry, { state: "invalid", reason: "the reported digest does not match the declaration", manifest: undefined })
      else entry.namespace = checked.namespace
    }
    const claims = new Map()
    for (const entry of entries) if (entry.namespace) claims.set(entry.namespace, (claims.get(entry.namespace) ?? 0) + 1)
    for (const entry of entries) {
      if (entry.namespace && claims.get(entry.namespace) > 1 && entry.state === "available") Object.assign(entry, { state: "conflict", reason: `another installed package claims the namespace ${entry.namespace}` })
    }

    const nowIso = this.#nowIso()
    handle.tx(() => {
      for (const entry of entries) {
        const known = handle.get("select * from plugins where plugin_id = ?", entry.id)
        if (entry.state === "unverified" && !known && !entry.declares) continue
        let edited = 0
        let reason = entry.reason
        if (entry.sourceKind === "package" && entry.packageName && entry.version && entry.digest && entry.manifest !== undefined) {
          handle.run(
            "insert into plugin_digests (plugin_id, package_name, source_ref, version, digest, first_seen) values (?, ?, ?, ?, ?, ?) on conflict do nothing",
            entry.id,
            entry.packageName,
            entry.sourceRef,
            entry.version,
            entry.digest,
            nowIso,
          )
          const first = handle.get("select digest from plugin_digests where plugin_id = ? and package_name = ? and source_ref = ? and version = ?", entry.id, entry.packageName, entry.sourceRef, entry.version)
          if (first && first.digest !== entry.digest) {
            edited = 1
            reason = reason ?? `${entry.packageName}'s installed copy was changed after install`
          }
        }
        // Unverified keeps the last known package and declaration: the plugin is not offered while unverified.
        const keep = entry.state === "unverified" && known
        handle.run(
          `insert into plugins (plugin_id, package_name, source_kind, source_ref, version, digest, manifest_json, namespace, state, reason, edited, first_seen, last_seen, listed_at)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(plugin_id) do update set package_name = excluded.package_name, source_kind = excluded.source_kind, source_ref = excluded.source_ref,
             version = excluded.version, digest = excluded.digest, manifest_json = excluded.manifest_json, namespace = excluded.namespace, state = excluded.state,
             reason = excluded.reason, edited = excluded.edited, last_seen = excluded.last_seen, listed_at = excluded.listed_at`,
          entry.id,
          keep ? known.package_name : entry.packageName,
          entry.sourceKind,
          entry.sourceRef,
          entry.version ?? (keep ? known.version : null),
          keep ? known.digest : entry.digest,
          keep ? known.manifest_json : entry.manifest === undefined ? null : JSON.stringify(entry.manifest),
          keep ? known.namespace : entry.namespace,
          entry.state,
          reason,
          keep ? known.edited : edited,
          known?.first_seen ?? nowIso,
          nowIso,
          nowIso,
        )
      }
      handle.run("insert into meta (key, value) values ('plugins_layout', ?) on conflict(key) do update set value = excluded.value", JSON.stringify({ changed: body.layout, at: nowIso }))
      pluginConsent.applyReport(handle, nowIso)
    })
    const nowMs = Date.parse(nowIso)
    return { plugins: handle.all("select * from plugins order by plugin_id").map((row) => this.#pluginRow(row, nowMs)), refused }
  }

  /** plugins.list: the plugins the person's collector reported, with their states, and whether the plugin store's layout changed. */
  async listPlugins(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Listing plugins needs a role in this space")
    requireObject(input, "plugins.list")
    const handle = this.#reader()
    const layout = parse(handle.get("select value from meta where key = 'plugins_layout'")?.value, null)
    return {
      plugins: handle.all("select * from plugins order by plugin_id").map((row) => this.#pluginRow(row, this.#settings.now().getTime())),
      retired_sources: retiredSources(handle),
      layout: { changed: layout?.changed === true, at: typeof layout?.at === "string" ? layout.at : null },
      ...pluginConsent.listConsents(handle, this.#nowIso()),
    }
  }

  /**
   * plugins.request, probe, consent, pause, resume and flag (S2): the person's
   * own, in their own personal space; consent and resume only from a browser
   * session. The logic is records/src/plugins/consent.js.
   */
  #pluginCall(actor, method, fn, { session = false } = {}) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", `${method} needs the editor role in this space`)
    this.#ownPersonalSpace(a, null, "A plugin source is managed")
    if (session && a.credential !== "session") throw pluginConsent.sessionRequired(method === "plugins.consent" ? "Confirming a plugin source" : "Turning a plugin back on")
    const handle = this.#writer(a)
    this.#ownPersonalSpace(a, handle, "A plugin source is managed")
    const nowMs = this.#settings.now().getTime()
    return handle.tx(() => {
      const sql = "select source,account,state,digest,live_digest,owner_id,scope_json,limits_json,snapshot_json,pause_code,declaration_changed,package_name,source_kind,source_ref,version from plugin_consents"
      const before = new Map(handle.all(sql).map((row) => [JSON.stringify([row.source, row.account]), row]))
      const result = fn({ handle, actor: a, nowIso: new Date(nowMs).toISOString(), nowMs })
      const after = new Map(handle.all(sql).map((row) => [JSON.stringify([row.source, row.account]), row]))
      // Same transaction as the public lifecycle operation: no pending work
      // can commit between the consent change and its partition fence.
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        if (JSON.stringify(before.get(key)) !== JSON.stringify(after.get(key))) fenceSilver(handle, after.get(key) ?? before.get(key))
      }
      return result
    })
  }

  async requestPlugin(input, actor) {
    return this.#pluginCall(actor, "plugins.request", (ctx) => pluginConsent.requestPlugin(ctx, input))
  }

  async probePlugin(input, actor) {
    return this.#pluginCall(actor, "plugins.probe", (ctx) => pluginConsent.probePlugin(ctx, input))
  }

  async consentPlugin(input, actor) {
    return this.#pluginCall(actor, "plugins.consent", (ctx) => pluginConsent.consentPlugin(ctx, input), { session: true })
  }

  /** plugins.reconfirm (N1): a bound source confirmed again under the declaration installed now. */
  async reconfirmPlugin(input, actor) {
    return this.#pluginCall(actor, "plugins.reconfirm", (ctx) => pluginConsent.reconfirmPlugin(ctx, input), { session: true })
  }

  async pausePlugin(input, actor) {
    return this.#pluginCall(actor, "plugins.pause", (ctx) => pluginConsent.pausePlugin(ctx, input))
  }

  async resumePlugin(input, actor) {
    return this.#pluginCall(actor, "plugins.resume", (ctx) => pluginConsent.resumePlugin(ctx, input), { session: true })
  }

  async flagPlugin(input, actor) {
    return this.#pluginCall(actor, "plugins.flag", (ctx) => pluginConsent.flagPlugin(ctx, input))
  }

  /** plugins.cancel: the person ends a request they no longer need (a session, or their own key). */
  async cancelPlugin(input, actor) {
    return this.#pluginCall(actor, "plugins.cancel", (ctx) => pluginConsent.cancelPlugin(ctx, input))
  }

  // -------------------------------------------------------------------------
  // Memory Jobs (records/src/jobs). One narrow seam: the runner gets this
  // space's handle, either read-only or inside one transaction, and owns the
  // job SQL itself. Role checks and the space's meta stay here, so the runner
  // cannot read a space it has no role in, and a system write never creates one.

  /** Read the job tables of this space. */
  async jobRead(actor, fn) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reading a job needs a role in this space")
    return fn(this.#reader())
  }

  /**
   * Write one page **and** the job runner's own writes in one transaction
   * (review follow-up: the block and the hash of it commit together, so a crash
   * between them cannot leave one without the other). The page goes through the
   * same `#put` path as `records.put`, so every guard applies.
   */
  async jobWritePage(actor, body, fn) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Writing a job's page needs the editor role in this space")
    const handle = this.#writer(a)
    const written = handle.tx(() => {
      const put = this.#put(body, a, null)
      fn?.(handle, put)
      return put
    })
    this.#meetingPage(written?.record)
    return written
  }

  /** Write the job tables of this space: one transaction, items and cursor together. */
  async jobTransaction(actor, fn) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Running a job needs the editor role in this space")
    const handle = this.#writer(a)
    return handle.tx(() => fn(handle))
  }

  // -------------------------------------------------------------------------
  // review.*

  /** review.list: open proposals, newest first. */
  async listProposals(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reviewing proposals needs a role in this space")
    const body = requireObject(input, "review.list")
    const limit = intInRange(body.limit, "limit", 1, 100, 50)
    const rows = this.#reader().all(
      "select * from records where kind = 'proposal' and (type <> 'team_write' or author_user = ?) and (status = 'accepting' or (status = 'proposed' and coalesce(json_extract(fields, '$.expires'), '9999') >= ?)) order by created desc, id desc limit ?",
      a.user,
      this.#nowIso(),
      limit,
    )
    return { proposals: rows.map((row) => pub(fromRow(row))) }
  }

  /**
   * Apply an accepted proposal's action. Returns `{applied, superseded?,
   * contested?, needs?}`: `applied` is the record created or changed (null for
   * a share, which the plugin applies through control).
   */
  #apply(handle, a, proposal, payload) {
    const action = proposal.type
    const fields = proposal.fields
    const targetId = fields.target_id ?? payload?.target_id
    const sourceOf = { record: proposal.id }
    const loadTarget = () => {
      if (!targetId) throw invalid("invalid_payload", `A ${action} proposal needs fields.target_id.`, "Edit the proposal with the record it changes.")
      const target = this.#load(handle, targetId)
      if (!target || !canRead(a, target.path)) throw notFound(`The proposal's target ${targetId} no longer exists.`, "Reject the proposal.")
      return target
    }
    const createFrom = (record, extra = {}) => {
      if (!isPlainObject(record)) throw invalid("invalid_payload", "The proposal's payload is not a record.", "Edit the proposal with a record payload {kind, type, body, …}.")
      if (record.kind === "proposal") throw invalid("invalid_payload", "A proposal cannot create another proposal.", "Edit the payload.")
      const fresh = newRecord({ source: sourceOf, ...record, ...extra }, a, this.#nowIso(), this.#settings.proposalTtlDays)
      this.#checkCreate(a, fresh)
      return this.#create(handle, a, fresh, this.#change(a, "create", { proposal: proposal.id }))
    }
    if (action === "create") {
      const done = createFrom(payload)
      return { applied: done.record, ...(done.superseded.length ? { superseded: done.superseded } : {}) }
    }
    if (action === "open_commitment") {
      const record = isPlainObject(payload) && payload.kind ? payload : { kind: "commitment", type: "commitment", fields: payload }
      const done = createFrom(record)
      return { applied: done.record }
    }
    if (action === "append") {
      const appendPath = payload?.path ?? fields.target_path
      if (!isPlainObject(payload) || typeof appendPath !== "string") {
        throw invalid("invalid_payload", "An append proposal needs a page (payload.path or fields.target_path) and {section, text}.", "Edit the payload.")
      }
      const target = this.#loadByPath(handle, checkPath(appendPath))
      if (!target || !canRead(a, target.path)) throw notFound(`No page at ${appendPath}.`, "Reject the proposal, or create the page first.")
      if (!canWrite(a, target.path)) throw forbidden(`You cannot change ${target.path}.`)
      if (typeof payload.section !== "string" || !payload.section.trim() || typeof payload.text !== "string" || !payload.text.trim()) {
        throw invalid("invalid_payload", "An append proposal needs a section and text.", "Edit the payload.")
      }
      // FIX-0914: an accepted append is the append it proposes: on a team page
      // a bearer's line is plain, as records.append requires.
      if (bearerOnTeamPage(a, handle.meta)) {
        if (JOURNAL_PATH.test(target.path)) throw pageLinesKept(`${target.path} is a journal page in a shared space; an agent does not write it.`)
        if (restylesTeamPage(payload.text)) {
          throw pageLinesKept(`An appended line on the team page ${target.path} may not hold an HTML comment or tag, a code fence, a heading or a setext underline, or start with a space.`, "Append plain lines.")
        }
      }
      // #58 review, finding 2: an append merges beside a later one instead of
      // going stale, so the guard is the section it adds to: if the page was
      // rewritten without it, the proposal was written against a page that is
      // gone.
      if (proposal.fields?.section_existed === true && !hasSection(target.body, payload.section)) {
        throw conflict(
          "version_conflict",
          `${target.path} has no "${payload.section}" section any more: it changed after the proposal was written.`,
          "Read the page again, and propose against the section it has now.",
          { current: pub(target) },
        )
      }
      const saved = this.#save(
        handle,
        target,
        markJournal({ ...target, body: appendToSection(target.body, payload.section, payload.text.replace(/\s+$/, "")) }, a),
        this.#change(a, "append", { section: payload.section.trim(), proposal: proposal.id }),
      )
      return { applied: saved }
    }
    if (action === "supersede" && payload?.mode === "contest") {
      // A contradiction: the target is marked contested until a person settles it.
      const target = loadTarget()
      if (!canWrite(a, target.path)) throw forbidden(`You cannot change ${target.id}.`)
      // FIX-0914: a bearer's revise does not contest a team page, so its
      // accept of a contest proposal does not either.
      if (target.kind === "page" && bearerOnTeamPage(a, handle.meta)) {
        throw pageLinesKept(`${target.path} is a page in a shared space; an agent does not contest it.`, "Add lines with records.append. The person settles a team page in Memory's console.")
      }
      const reason = typeof payload.reason === "string" ? payload.reason : fields.reason
      const next = {
        ...target,
        status: "contested",
        fields: { ...target.fields, ...(reason ? { contested_reason: reason } : {}), ...(typeof payload.against === "string" ? { contested_with: payload.against } : {}) },
      }
      const saved = this.#save(handle, target, markJournal(next, a), this.#change(a, "contest", { proposal: proposal.id, ...(reason ? { reason } : {}) }))
      return { applied: saved, contested: [saved.id] }
    }
    if (action === "supersede") {
      const target = loadTarget()
      if (!canWrite(a, target.path)) throw forbidden(`You cannot change ${target.id}.`)
      if (target.kind === "page") {
        const next = markJournal(updatedRecord(target, { body: payload?.body, title: payload?.title, fields: payload?.fields }, a, this.#nowIso()), a)
        // FIX-0914: an accepted proposal is a write like any other. On a team
        // page a bearer's accept only inserts lines, as its put does; the
        // proposal route never stood in for the console's edit.
        if (bearerOnTeamPage(a, handle.meta)) {
          const kept = teamPageLinesRefusal(target, next)
          if (kept) throw kept
        }
        const saved = this.#save(handle, target, next, this.#change(a, "supersede", { proposal: proposal.id }))
        return { applied: saved }
      }
      const record = isPlainObject(payload) && payload.kind ? payload : { kind: target.kind, type: target.type, fields: target.fields, ...payload }
      const done = createFrom(record, { supersedes: [target.id] })
      return { applied: done.record, superseded: done.superseded }
    }
    if (action === "merge" && isPlainObject(payload?.identities)) {
      // An account linked to a person's page: its identities and aliases join
      // the page's, and an identity already there is **kept**: a merge adds,
      // never overwrites (J4 review, finding 1).
      const mergePath = payload.path ?? fields.target_path
      const target = targetId ? this.#load(handle, requireId(targetId, "fields.target_id")) : typeof mergePath === "string" ? this.#loadByPath(handle, checkPath(mergePath)) : null
      if (!target || !canRead(a, target.path)) throw notFound("The page this merge links to no longer exists.", "Reject the proposal.")
      if (!canWrite(a, target.path)) throw forbidden(`You cannot change ${target.path ?? target.id}.`)
      const outside = Object.keys(payload).filter((key) => !["identities", "aliases", "path"].includes(key))
      if (outside.length) throw invalid("invalid_payload", `A merge proposal cannot write ${outside.join(", ")}.`, "Send only identities and aliases to add.")
      const identities = { ...(isPlainObject(target.fields.identities) ? target.fields.identities : {}) }
      for (const [network, handleName] of Object.entries(payload.identities)) {
        if (typeof handleName !== "string") continue
        identities[network] = addIdentityValue(identities[network], handleName)
      }
      const aliases = Array.isArray(payload.aliases)
        ? [...new Set([...(Array.isArray(target.fields.aliases) ? target.fields.aliases : []), ...payload.aliases.filter((alias) => typeof alias === "string")])]
        : target.fields.aliases
      const next = updatedRecord(target, { fields: { identities, ...(aliases ? { aliases } : {}) } }, a, this.#nowIso())
      const saved = this.#save(handle, target, markJournal(next, a), this.#change(a, "merge", { proposal: proposal.id }))
      return { applied: saved }
    }
    if (action === "merge") {
      const ids = [...new Set([...(targetId ? [targetId] : []), ...(Array.isArray(payload?.ids) ? payload.ids : [])])]
      if (ids.length < 2) throw invalid("invalid_payload", "A merge proposal names at least two records (fields.target_id and payload.ids).", "Edit the payload.")
      for (const id of ids) requireId(id, "each id to merge")
      const first = this.#load(handle, ids[0])
      if (!first) throw notFound(`The record ${ids[0]} to merge no longer exists.`, "Reject the proposal.")
      const record = isPlainObject(payload?.record) ? payload.record : { kind: first.kind, type: first.type, body: payload?.body }
      const done = createFrom(record, { supersedes: ids })
      return { applied: done.record, superseded: done.superseded }
    }
    if (action === "link") {
      // A page field a job needs to find its project (§6.2): the person's accept
      // writes it. Arrays are unioned, so accepting twice adds nothing, and a
      // scalar is set once.
      const linkPath = payload?.path ?? fields.target_path
      const target = targetId ? this.#load(handle, requireId(targetId, "fields.target_id")) : typeof linkPath === "string" ? this.#loadByPath(handle, checkPath(linkPath)) : null
      if (!target || !canRead(a, target.path)) throw notFound("The page this link changes no longer exists.", "Reject the proposal.")
      if (!canWrite(a, target.path)) throw forbidden(`You cannot change ${target.path ?? target.id}.`)
      if (!isPlainObject(payload?.fields) || Object.keys(payload.fields).length === 0) {
        throw invalid("invalid_payload", "A link proposal needs the fields it writes (payload.fields).", "Edit the payload.")
      }
      // Only an identity, an alias or a link may be added, and only added
      // (J4 review, finding 5): never `owner_job`, `tags` or any other field.
      const LINK_FIELDS = new Set(["identities", "aliases", "links", "slack_channels", "repos", "linear_projects"])
      const outside = Object.keys(payload.fields).filter((key) => !LINK_FIELDS.has(key))
      if (outside.length) {
        throw invalid("invalid_payload", `A link proposal cannot write ${outside.join(", ")}.`, "Send only identities, aliases, links or a project field such as slack_channels.")
      }
      const next = { ...(isPlainObject(target.fields) ? target.fields : {}) }
      for (const [key, value] of Object.entries(payload.fields)) {
        if (key === "identities" && isPlainObject(value)) {
          const identities = { ...(isPlainObject(next.identities) ? next.identities : {}) }
          for (const [network, handleName] of Object.entries(value)) if (typeof handleName === "string") identities[network] = addIdentityValue(identities[network], handleName)
          next.identities = identities
          continue
        }
        if (Array.isArray(value)) next[key] = [...new Set([...(Array.isArray(next[key]) ? next[key] : []), ...value.filter((item) => typeof item === "string")])]
        else if (typeof value === "string") next[key] = value
      }
      const saved = this.#save(handle, target, markJournal(updatedRecord(target, { fields: next }, a, this.#nowIso()), a), this.#change(a, "link", { proposal: proposal.id }))
      return { applied: saved }
    }
    if (action === "close_commitment") {
      const target = loadTarget()
      if (target.kind !== "commitment") throw invalid("invalid_payload", `${target.id} is not a commitment.`, "Reject the proposal.")
      if (!canWrite(a, target.path)) throw forbidden(`You cannot change ${target.id}.`)
      const state = payload?.state === "cancelled" ? "cancelled" : "done"
      const next = updatedRecord(target, { fields: { state } }, a, this.#nowIso())
      const saved = this.#save(handle, target, next, this.#change(a, "close", { proposal: proposal.id }))
      return { applied: saved }
    }
    // share: grants live in control; the plugin applies it with the person's ask.
    return { applied: null, needs: "control", payload: payload ?? null }
  }

  /**
   * review.decide: accept, edit (then accept) or reject. The decision records
   * how the decider was established (`decided_via`: session, bearer or
   * routine), and only a browser session stamps `stated_by: person`: a bearer
   * (an agent, an API key) cannot speak for the person (FABLE records #4).
   * A reject's reason is kept on the proposal (`decision_reason`); only a
   * reason the person typed in the console (a browser session) also becomes a
   * preference memory. An agent's or a routine's reason is never a memory
   * (0.9.9 gate, inj-review-permission #4 and #5).
   */
  async decideProposal(input, actor) {
    return this.#decideProposal(requireObject(input, "review.decide"), actor)
  }

  /**
   * Retire one meeting proposal **and scrub its words from every version**
   * (0.11 review, should-fix 1 and 2): the row keeps its ids and the citation's
   * location, and `records.history` cannot show the quote either. Called by the
   * job runner when the page is deleted, or when a re-read page no longer holds
   * the line a waiting proposal quoted.
   */
  async retireMeetingProposal(input, actor) {
    const a = normalizeActor(actor)
    const body = requireObject(input, "meetings.retire")
    const id = requireId(body.id)
    const handle = this.#existing(a)
    const current = handle ? this.#load(handle, id) : null
    if (!current || current.kind !== "proposal" || !visibleRecord(a, current)) throw notFound(`No proposal ${id} in this space.`, "List open proposals with review.list.")
    if (current.status !== "proposed") return { record: pub(current), retired: false }
    return handle.tx(() => {
      const fresh = this.#load(handle, id)
      if (!fresh) throw notFound(`No proposal ${id} in this space.`, "List open proposals with review.list.")
      const scrubbed = scrubMeetingProposal(fresh)
      const saved = this.#save(
        handle,
        fresh,
        {
          ...fresh,
          status: "retired",
          title: scrubbed.title,
          body: scrubbed.body,
          fields: { ...scrubbed.fields, retired_reason: String(body.reason ?? "the page no longer holds this line").slice(0, 200), retired_at: this.#nowIso() },
        },
        this.#change(a, "retire"),
      )
      // The version `#save` just wrote holds the pre-scrub text: scrub every
      // stored version, newest and oldest alike.
      this.#scrubVersions(handle, id)
      return { record: pub(saved), retired: true }
    })
  }

  /** Remove the quoted words from every stored version of one proposal. */
  #scrubVersions(handle, id) {
    for (const row of handle.all("select version, snapshot from versions where record_id = ?", id)) {
      let record
      try {
        record = JSON.parse(row.snapshot)
      } catch {
        continue
      }
      const scrubbed = scrubMeetingProposal(record)
      handle.run(
        "update versions set snapshot = ? where record_id = ? and version = ?",
        JSON.stringify({ ...record, title: scrubbed.title, body: scrubbed.body, fields: scrubbed.fields }),
        id,
        row.version,
      )
    }
  }

  /**
   * The decision itself, synchronous so an act can make it inside the grant's
   * transaction: `applyActReview` calls this with the same body.
   */
  #decideProposal(body, actor, existing = null) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Deciding proposals needs the editor role in this space")
    const id = requireId(body.id)
    const handle = existing ?? this.#existing(a)
    const found = handle ? this.#load(handle, id) : null
    if (!found || found.kind !== "proposal" || !visibleRecord(a, found)) throw notFound(`No proposal ${id} in this space.`, "List open proposals with review.list.")
    if (found.type === "team_write") return this.#decideTeamWrite(handle, a, body, id)
    if (!DECISIONS.includes(body.decision)) throw invalid("invalid_request", `decision is accept, reject or edit, not "${body.decision}".`, "Send one of accept, reject, edit.")
    if (body.decision === "edit" && body.payload === undefined) throw invalid("invalid_payload", "edit needs the edited payload.", "Send payload with the change to apply.")
    if (body.reason !== undefined && (typeof body.reason !== "string" || body.reason.length > 2000)) {
      throw invalid("invalid_request", "reason must be text of at most 2000 characters.", "Shorten the reason.")
    }
    if (body.confirm_pinned !== undefined && typeof body.confirm_pinned !== "boolean") {
      throw invalid("invalid_request", "confirm_pinned must be true or false.", "Send true only after the person was asked.")
    }
    if (found.status !== "proposed") throw conflict("conflict", `${id} was already ${found.status}.`, "List open proposals with review.list.")
    const reason = body.reason?.trim() || null
    const via = decidedVia(a)
    return handle.tx(() => {
      const proposal = this.#load(handle, id)
      // #58 review, finding 5: a proposal that replaces a page's lines carries
      // the version it was written against, and accepting it after the page
      // moved on is a conflict. An append is not line-changing: it merges
      // beside whatever landed first (its own check is the section, in #apply),
      // and rejecting or questioning a proposal never reads a version at all.
      const baseVersion = proposal.fields?.base_version
      const lineChanging = proposal.type !== "append"
      if (lineChanging && (body.decision === "accept" || body.decision === "edit") && Number.isInteger(baseVersion)) {
        const targetId = proposal.fields?.target_id ?? proposal.fields?.payload?.target_id
        const targetPath = proposal.fields?.target_path ?? proposal.fields?.payload?.path
        const target = typeof targetId === "string" ? this.#load(handle, targetId) : typeof targetPath === "string" ? this.#loadByPath(handle, targetPath) : null
        if (target && target.version !== baseVersion) {
          throw conflict(
            "version_conflict",
            `${target.path ?? target.id} is at version ${target.version}, not ${baseVersion}: it changed after the proposal was written.`,
            "Read the page again, and propose or decide against its current version.",
            { current: pub(target) },
          )
        }
      }
      const nowIso = this.#nowIso()
      const decided = { decided_at: nowIso, decided_by: a.user, decided_via: via, ...(reason ? { decision_reason: reason } : {}) }
      if (body.decision === "reject") {
        // A rejected proposal keeps its ids and where it pointed, never the text
        // it quoted (0.11 re-review): a meeting line the person refused is not
        // kept in the space by the review that refused it.
        const scrubbed = proposal.fields?.meeting ? scrubMeetingProposal(proposal) : proposal
        const saved = this.#save(handle, proposal, { ...proposal, status: "rejected", ...(scrubbed !== proposal ? { title: scrubbed.title, body: scrubbed.body } : {}), fields: { ...scrubbed.fields, ...decided } }, this.#change(a, "reject", reason ? { reason } : {}))
        // Every earlier version loses the quote too (0.11 review, should-fix 1).
        if (scrubbed !== proposal) this.#scrubVersions(handle, proposal.id)
        let preference = null
        let preferenceRefused = null
        if (reason && via === "session") {
          const fresh = newRecord(
            {
              kind: "memory",
              type: "preference",
              body: reason,
              stated_by: "person",
              source: { record: proposal.id, ...(a.session ? { session: a.session } : {}) },
              fields: { from_proposal: proposal.id },
            },
            a,
            nowIso,
            this.#settings.proposalTtlDays,
          )
          const verdict = refusal(fresh.body)
          if (verdict) preferenceRefused = verdict.message
          else preference = this.#create(handle, a, fresh, this.#change(a, "create", { proposal: proposal.id })).record.id
        }
        return {
          proposal: pub(saved),
          ...(preference ? { preference } : {}),
          ...(preferenceRefused ? { preference_refused: preferenceRefused } : {}),
        }
      }
      let payload = body.decision === "edit" ? body.payload : proposal.fields.payload
      // An edit outside a browser session cannot make a payload the person's statement.
      if (body.decision === "edit" && via !== "session" && isPlainObject(payload) && payload.stated_by === "person" && proposal.fields.payload?.stated_by !== "person") payload = { ...payload, stated_by: "agent" }
      // The person approving, in the console, what a routine attributed to them makes it theirs.
      if (via === "session" && proposal.fields?.attributed_to === "person" && isPlainObject(payload) && ["memory", "commitment"].includes(payload.kind)) payload = { ...payload, stated_by: "person" }
      // An externally attributed proposal is somebody else's statement, whoever
      // accepts it: it never becomes the person's (J4 review, finding 3). A
      // payload with no `stated_by` would default to the session's "person", so
      // the attribution sets it here rather than only correcting it.
      if (proposal.fields?.attributed_to === "external" && isPlainObject(payload) && ["memory", "commitment"].includes(payload.kind)) {
        payload = { ...payload, stated_by: "external" }
      }
      // The team-page rule for an accepted proposal lives in #apply, beside the
      // one #update runs (teamPageLinesRefusal, FIX-0914): a bearer's accept
      // inserts lines and can neither replace them nor retitle the page, which
      // is exactly what its own append may do. A rewrite is the person's, in
      // the console.
      const { applied, ...rest } = this.#apply(handle, a, proposal, payload)
      // Slice 7 (P2): decided from what was written, after the target was
      // resolved as #apply resolves it, so no field can route around it. The
      // throw rolls the whole decision back.
      if (via !== "session" && body.confirm_pinned !== true && this.#touchesPinned(handle, [applied?.id, ...(rest.superseded ?? []), ...(rest.contested ?? [])])) {
        throw conflict("pinned_confirmation_required", "Accepting this proposal changes the pinned dashboard (index), which every later session is shown.", "Ask the person, then decide again with confirm_pinned: true; or decide it in Memory's console.")
      }
      const latest = this.#load(handle, id)
      const fields = { ...latest.fields, ...decided, ...(body.decision === "edit" ? { payload, edited: true } : {}) }
      const saved = this.#save(handle, latest, { ...latest, status: "accepted", fields }, this.#change(a, body.decision, reason ? { reason } : {}))
      return { proposal: pub(saved), applied: applied ? pub(applied) : null, ...rest }
    })
  }

  /** True when any of these records is a pinned page (`index`, placed in every session's system prompt). */
  #touchesPinned(handle, ids) {
    for (const id of ids) {
      if (typeof id !== "string" || !id) continue
      const record = this.#load(handle, id)
      if (record?.kind === "page" && PINNED_PAGES.includes(record.path)) return true
    }
    return false
  }

  /** A decision is made only in the author's personal store. */
  #decideTeamWrite(handle, actor, body, id) {
    if (!["accept", "private", "decline"].includes(body.decision)) throw invalid("invalid_request", "A team write takes accept, private or decline.", "Send one decision.")
    if (Object.keys(body).some((key) => !["id", "decision", "base_version", "receipt"].includes(key))) throw invalid("invalid_request", "A team-write decision does not accept client-supplied result ids.", "Send only the decision and its version.")
    return handle.tx(() => {
      const proposal = this.#load(handle, id)
      if (actor.spaceKind !== "personal" || actor.role !== "owner" || proposal.author.user !== actor.user || handle.meta?.owner_user !== actor.user) throw forbidden("Only the author in their personal space can decide this proposal.")
      if (proposal.status !== "proposed" && proposal.status !== "accepting") return { proposal: pub(proposal), replayed: true }
      if (proposal.status === "accepting") {
        if (body.decision !== "accept" || body.receipt === undefined) return { proposal: pub(proposal), replayed: true }
        if (!Number.isInteger(body.base_version) || body.base_version !== proposal.version) throw conflict("version_conflict", "The acceptance changed since it was read.", "Read it again before completing it.")
        const records = parse(proposal.body, null)?.records ?? []
        const expected = { v: 1, user: actor.user, space: proposal.fields.space_id, key: proposal.fields.accept_key, digest: sha256(JSON.stringify(records)) }
        if (!validHeldReceipt(this.#settings.heldReceiptKey, body.receipt, expected)) throw forbidden("The shared cell did not prove this held write was applied.")
        const saved = this.#save(handle, proposal, { ...proposal, status: "applied" }, this.#change(actor, "applied"))
        return { proposal: pub(saved) }
      }
      if (!Number.isInteger(body.base_version) || body.base_version !== proposal.version) throw conflict("version_conflict", "The proposal changed since it was read.", "Read it again before deciding.")
      const fields = { ...proposal.fields, decided_by: actor.user, decided_via: decidedVia(actor), decided_at: this.#nowIso() }
      if (body.decision === "decline") {
        const saved = this.#save(handle, proposal, { ...proposal, status: "declined", fields }, this.#change(actor, "decline"))
        return { proposal: pub(saved) }
      }
      if (body.decision === "private") {
        this.#applyHeldItems(handle, actor, parse(proposal.body, null)?.records ?? [], true)
        const saved = this.#save(handle, proposal, { ...proposal, status: "applied_private", fields }, this.#change(actor, "applied_private"))
        return { proposal: pub(saved) }
      }
      const acceptKey = `ha_${sha256(`${this.#spaceId}:${id}`)}`
      const saved = this.#save(handle, proposal, { ...proposal, status: "accepting", fields: { ...fields, accept_key: acceptKey } }, this.#change(actor, "accepting"))
      return { proposal: pub(saved) }
    })
  }

  // -------------------------------------------------------------------------
  // space.*

  /** space.stats: counts by kind and status, events, sources, last runs. */
  async stats(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Space statistics need a role in this space")
    requireObject(input, "space.stats")
    const handle = this.#reader()
    const records = {}
    let total = 0
    for (const row of handle.all("select kind, status, count(*) as n from records where (kind <> 'proposal' or type <> 'team_write' or author_user = ?) group by kind, status", a.user)) {
      records[row.kind] ??= {}
      records[row.kind][row.status] = Number(row.n)
      total += Number(row.n)
    }
    const events = handle.all("select source, account, count(*) as n, min(occurred_at) as oldest, max(occurred_at) as newest from events group by source, account")
    const sources = handle.all("select status, enabled, count(*) as n from sources group by status, enabled")
    const runs = handle.all("select run from runs order by started desc, seq desc limit 10")
    let bytes = 0
    if (handle.file) {
      for (const suffix of ["", "-wal"]) {
        try {
          bytes += fs.statSync(`${handle.file}${suffix}`).size
        } catch {
          // no such file
        }
      }
    }
    return {
      idempotent_put: true,
      idempotent_replay: replayCapability(this.#settings),
      held_receipts: Boolean(this.#settings.heldReceiptKey),
      // True only when at least one action key is loaded (§4.3): a plugin reads
      // this before it offers an act, and answers grant_unavailable when false.
      act_grants: Boolean(this.#settings.actKeys?.available?.() && !this.#settings.actKeys?.stale?.()),
      records: { total, by_kind: records },
      proposals_open: records.proposal?.proposed ?? 0,
      events: {
        total: events.reduce((sum, row) => sum + Number(row.n), 0),
        by_source: events.map((row) => ({ source: row.source, account: row.account, count: Number(row.n), oldest: row.oldest, newest: row.newest })),
      },
      sources: {
        total: sources.reduce((sum, row) => sum + Number(row.n), 0),
        confirmed: sources.filter((row) => row.status === "confirmed").reduce((sum, row) => sum + Number(row.n), 0),
        pending: sources.filter((row) => row.status === "pending").reduce((sum, row) => sum + Number(row.n), 0),
        enabled: sources.filter((row) => row.status === "confirmed" && row.enabled).reduce((sum, row) => sum + Number(row.n), 0),
        requested: Number(handle.get("select count(*) as n from source_requests")?.n ?? 0),
        attention: Number(handle.get("select count(*) as n from source_requests where state = 'attention'")?.n ?? 0),
        // Removals still finishing (0.11 review R6-S2): mem_spaces health reads it.
        retractions_pending: Number(handle.get("select count(*) as n from events where retract_pending = 1")?.n ?? 0),
        citation_index: (handle.get("select value from meta where key = 'cite_edges'")?.value ?? "") === "done" ? "done" : "building",
      },
      last_runs: runs.map((row) => redactedRun(parse(row.run, {}))),
      bytes,
      schema_version: handle.file ? Number(handle.get("select value from meta where key='schema_version'")?.value ?? SCHEMA_VERSION) : null,
    }
  }

  // -------------------------------------------------------------------------
  // Person-level erasure (Jelly ID's `account.deleted`; docs/jelly-account-deletion.md)

  /**
   * person.erase: the records half of one person's erasure in this space.
   *
   * A shared space keeps the team's own pages and records; what goes is the
   * person: every copy of their private memory (`fields.copied_from.space` is
   * their personal space), the held batches, keyed-write ledgers, forgotten-copy
   * keys and spent grants that name them, and the requests and proposals they
   * made. Their authorship of what remains becomes `former-member`, in the
   * current row and in every stored version, so no page still names them.
   *
   * Their core layers (L0 turns, L1 atoms) are purged here too, under their own
   * user id, because the service is the one component that reaches both. Both
   * halves are idempotent: a retried job erases nothing twice.
   */
  async personErase(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "admin", "Erasing a person needs the admin or owner role in this space")
    if (a.erase !== true) {
      throw forbidden("Erasing a person needs the erase credential, not a records key.", "erase_forbidden")
    }
    const body = requireObject(input, "person.erase")
    const user = text(body.user)
    if (!user || !USER_ID_LIKE.test(user)) {
      throw invalid("invalid_user", "user must be a control user id.", "Send the erased user's id as {user}.")
    }
    const personal = text(body.personal_space) ?? ""
    if (personal && !SPACE_ID.test(personal)) {
      throw invalid("invalid_space", "personal_space must be a space id.", "Send the person's personal space id as {personal_space}.")
    }
    // The core's own user id (control's `upstream_user_id`) and container: the
    // scope a strict-isolation cell requires, and the id its rows are keyed by.
    const upstream = text(body.upstream_user) ?? ""
    if (!upstream || !USER_ID_LIKE.test(upstream)) {
      throw invalid("invalid_user", "upstream_user must be the core's user id.", "Send control's upstream_user_id as {upstream_user}.")
    }
    const container = text(body.container) ?? ""
    if (!container || !SPACE_ID.test(container)) {
      throw invalid("invalid_space", "container must be a container id.", "Send the personal placement's container_id as {container}.")
    }
    const agent = text(body.personal_agent) ?? null
    if (agent !== null && !USER_ID_LIKE.test(agent)) {
      throw invalid("invalid_request", "personal_agent must be an agent name.", "Send the person's personal_agent, or leave it out.")
    }
    const assets = Array.isArray(body.assets)
      ? body.assets
          .filter((asset) => asset && ["skill", "wiki", "code_graph"].includes(asset.kind))
          .map((asset) => ({ kind: asset.kind, id: String(asset.id), ...(Number.isInteger(asset.version) ? { version: asset.version } : {}) }))
      : []
    const exclusive = body.exclusive !== false

    // The core is not inside this space's file, so it goes even when the file
    // is already gone (a resumed erase), and it is read back before control
    // may call the erasure done. The person's audit and knowledge rows are a
    // separate method (`personEraseCore`): a core that is slow or failing must
    // never hold this purge.
    let core = { configured: false }
    if (this.#settings.personCore) {
      core = await this.#settings.personCore({ container, userId: upstream, agent, assets, exclusive })
    }

    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { space: this.#spaceId, core, records: 0, anonymised: 0, erase: { secure_delete: true, wal: "none" } }

    // Revoke the Silver generation before the first yielding claims cascade.
    // Requests and consents are still present here, even when the source's
    // external owner is not a control user id.
    const silverOwners = [...new Set([user, upstream])]
    const silverMarks = silverOwners.map(() => "?").join(",")
    handle.tx(() => {
      const personalOwner = handle.get("select value from meta where key='owner_user'")?.value
      if (silverOwners.includes(personalOwner)) {
        this.#invalidateSilver(handle, { all: true })
        return
      }
      for (const row of handle.all(`select source,account from sources where owner_id in (${silverMarks})
        union select source,account from source_requests where requested_by in (${silverMarks})
        union select source,account from plugin_consents where consented_by in (${silverMarks})`, ...silverOwners, ...silverOwners, ...silverOwners)) {
        this.#invalidateSilver(handle, { identity: row })
      }
    })

    // The claims log first, in its own transactions: a person's forget is
    // sliced and resumes from its pending flag, so the erasure never holds one
    // large write (S2 re-review, M4). The switch is forced on: an erasure is
    // never a routine that can be turned off.
    if (hasTable(handle, "claims")) {
      const owner = handle.get("select value from meta where key = 'owner_user'")?.value
      const forms = [`other:${user}`, ...(upstream && upstream !== user ? [`other:${upstream}`] : []), ...(owner === user ? ["person"] : [])]
      // A forget this space left pending is finished first, so the erasure
      // never leaves another person's queued work half done. Each drain yields
      // between slices, so the erasure never blocks the loop for one long
      // forget.
      // Every one of these awaits with the handle in scope: the space is held for
      // the whole cascade (review M5).
      const held = this.#settings.acquireSpace?.(this.#spaceId)
      try {
        for (const row of pendingForgets(handle)) {
          await drainForget(handle, { pendingId: row.id }, { env: { RECORDS_CLAIMS: "on" } })
        }
        await drainForget(handle, { statedBy: forms }, { env: { RECORDS_CLAIMS: "on" } })
      } finally {
        held?.release()
      }
    }

    const counts = handle.tx(() => {
      const copies = personal
        ? handle
            .all(
              "select id from records where json_extract(fields, '$.copied_from.space') = ?",
              personal,
            )
            .map((row) => String(row.id))
        : []
      for (const id of copies) {
        handle.run(
          "insert into delete_audit (at, action, record_id, record_kind, actor_user, principal, credential, space) values (?, 'erase', ?, 'memory', ?, ?, ?, ?)",
          this.#nowIso(),
          id,
          a.user,
          "account-feed",
          a.credential ?? null,
          this.#spaceId,
        )
        this.#hardDelete(handle, id)
      }
      // A proposal drawn from this person's meeting page quotes their words in
      // its title, body and evidence: it goes with them (0.11 review, nit). Run
      // before the anonymisation, so the page's author still names them.
      const meetingProposals = handle
        .all("select id from records where kind = 'proposal' and json_extract(fields, '$.meeting_id') in (select id from records where author_user = ?)", user)
        .map((row) => String(row.id))
      for (const id of meetingProposals) {
        handle.run(
          "insert into delete_audit (at, action, record_id, record_kind, actor_user, principal, credential, space) values (?, 'erase', ?, 'proposal', ?, ?, ?, ?)",
          this.#nowIso(),
          id,
          a.user,
          "account-feed",
          a.credential ?? null,
          this.#spaceId,
        )
        this.#hardDelete(handle, id)
      }
      const anonymised = Number(
        handle.run("update records set author_user = ? where author_user = ?", ANONYMOUS_AUTHOR, user)
          .changes,
      )
      // Every other place the row names them: its owner, its change entry, and
      // the sources and jobs they set up for the team (their configuration
      // stays; their name does not).
      handle.run("update records set owner = ? where owner = ?", ANONYMOUS_AUTHOR, user)
      handle.run(
        "update records set change = replace(change, ?, ?) where change like ?",
        `"user":${JSON.stringify(user)}`,
        `"user":${JSON.stringify(ANONYMOUS_AUTHOR)}`,
        `%${user}%`,
      )
      // The personal agent's name rides in the same entry, as `by.agent`.
      handle.run(
        "update records set change = replace(change, ?, ?) where change like ?",
        `"agent":"personal_${user}"`,
        `"agent":${JSON.stringify(ANONYMOUS_AUTHOR)}`,
        `%${user}%`,
      )
      // A source they bound is their account's: its collected items, its
      // consents, its proposals and its resync ledger go with it. Guarded, so
      // a file from a schema without these tables erases the same way.
      // The person's rows carry three id forms: the Memory user id, the core's
      // upstream id, and the external account owner a real source or job
      // reports (`google:<address>`, `slack:U…`) through `#owner`. A team
      // source or job is theirs when any of those match, or when they are the
      // person who asked for it: `source_requests.requested_by` and
      // `plugin_consents.consented_by` are the Memory-side link.
      const idForms = [user, ...(upstream && upstream !== user ? [upstream] : [])]
      const marks = idForms.map(() => "?").join(", ")
      const boundAccounts = hasTable(handle, "source_requests")
        ? ` or (source, account) in (select source, account from source_requests where requested_by in (${marks}))`
        : ""
      const ownedSources = handle.all(
        `select source, account, owner_id from sources where owner_id in (${marks})${boundAccounts}`,
        ...idForms,
        ...(boundAccounts ? idForms : []),
      )
      // The account is a handle (an address or a Slack id). Their collector is
      // gone, so the row keeps no handle: it becomes a random opaque id, not a
      // hash of the handle (which anyone with an address list could recompute).
      const ownedJobs = hasTable(handle, "job_consents")
        ? handle.all(
            `select id, account, owner_id from jobs where owner_id in (${marks})
             union select id, account, owner_id from jobs where id in (select job_id from job_consents where consented_by in (${marks}))`,
            ...idForms,
            ...idForms,
          )
        : handle.all(`select id, account, owner_id from jobs where owner_id in (${marks})`, ...idForms)
      // The external owner strings their own rows carry (`google:<address>`):
      // every later match takes them as one more id form.
      const externalOwners = [...new Set([...ownedSources, ...ownedJobs].map((row) => row.owner_id))].filter(
        (value) => typeof value === "string" && value && !idForms.includes(value),
      )
      const personIds = [...idForms, ...externalOwners]
      const personMarks = personIds.map(() => "?").join(", ")
      const pseudonyms = new Map()
      for (const { source, account } of ownedSources) {
        pseudonyms.set(account, `former-member-${randomBytes(6).toString("hex")}`)
        // A source's collected items, its consents, its proposals and its
        // resync ledger go with it. Guarded, so a file from a schema without
        // these tables erases the same way. Its units' read marks go too: no
        // mark names the erased person's source or thread, and the same ids
        // are read if they are ever collected again (lane 0134, L). The gate's
        // verdicts on the items go with them as well (lane 0198, review L).
        this.#dropMarksOf(handle, "where source = ? and account = ?", [source, account])
        this.#dropTraitReadsOf(handle, "where source = ? and account = ?", [source, account])
        for (const table of [
          "events",
          "event_refusals",
          "source_collections",
          "binding_resyncs",
          "plugin_pending",
          "plugin_changes",
          "plugin_consents",
          "source_requests",
          "plugin_requests",
          // The engine's lane state names the account it reads (S3a): a cursor,
          // a retry row and a ledger line are about their items, so they go with
          // them. `lane_expired` counts items by source and lane and names no
          // account, so it stays as the I7 tally.
          "lane_cursors",
          "lane_retry",
          "lane_ledger",
        ]) {
          if (!hasTable(handle, table)) continue
          handle.run(`delete from ${table} where source = ? and account = ?`, source, account)
        }
        // A claim the trait gate held for one of their events goes with the
        // event: a hold keeps the claim's own words and its ref (design §5.4).
        if (hasTable(handle, "trait_holds")) {
          handle.run("delete from trait_holds where ref is null or ref not in (select id from events)")
        }
      }
      // A job they own names the account it reads even after the source row is
      // gone: it is their handle all the same, and its spec, its items and its
      // run logs quote it. The consent and the request carry it too.
      for (const row of ownedJobs) {
        if (row.account && !pseudonyms.has(row.account)) {
          pseudonyms.set(row.account, `former-member-${randomBytes(6).toString("hex")}`)
        }
      }
      for (const [account, pseudonym] of pseudonyms) {
        handle.run("update jobs set account = ? where account = ?", pseudonym, account)
        // A consent is recorded against the account it was granted for, so it
        // follows the job's pseudonym rather than keeping the handle.
        if (hasTable(handle, "job_consents")) {
          handle.run("update job_consents set account = ? where account = ?", pseudonym, account)
        }
        // What their account read: the items and the curation, withdrawal and
        // extraction ledgers keyed with the external ids of those items. The
        // same content as the events above.
        for (const table of ["job_items", "job_curation", "job_withdrawals", "job_extracted"]) {
          if (!hasTable(handle, table)) continue
          handle.run(`delete from ${table} where account = ?`, account)
        }
        // The job spec a version keeps names the account it reads and the owner
        // who confirmed it, and the run and log text quotes the account.
        if (hasTable(handle, "job_versions")) {
          handle.run(
            "update job_versions set doc = replace(doc, ?, ?) where doc like ?",
            `"account":${JSON.stringify(account)}`,
            `"account":${JSON.stringify(pseudonym)}`,
            `%${account}%`,
          )
          handle.run(
            "update job_versions set doc = replace(doc, ?, ?) where doc like ?",
            `"label":${JSON.stringify(account)}`,
            `"label":${JSON.stringify(ANONYMOUS_AUTHOR)}`,
            `%${account}%`,
          )
        }
        if (hasTable(handle, "job_logs")) {
          handle.run(
            "update job_logs set detail = replace(detail, ?, ?) where detail like ?",
            account,
            pseudonym,
            `%${account}%`,
          )
        }
        if (hasTable(handle, "job_runs")) {
          for (const column of ["cursor_before", "cursor_after", "error", "outcome"]) {
            handle.run(
              `update job_runs set ${column} = replace(${column}, ?, ?) where ${column} like ?`,
              account,
              pseudonym,
              `%${account}%`,
            )
          }
        }
      }
      for (const { source, account } of ownedSources) {
        const pseudonym = pseudonyms.get(account)
        handle.run(
          "update sources set account = ?, owner_id = ?, owner_label = ? where source = ? and account = ?",
          pseudonym,
          ANONYMOUS_AUTHOR,
          ANONYMOUS_AUTHOR,
          source,
          account,
        )
      }
      // The display labels carry the person's account, so they go before the
      // ids are replaced (which would make the row match every former member).
      handle.run(`update sources set owner_label = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      // A job's owner id is the external account owner a real row reports, so
      // the row is selected by its id, not by matching that string.
      const ownedJobIds = ownedJobs.map((row) => row.id)
      const ownedJobMarks = ownedJobIds.map(() => "?").join(", ")
      if (ownedJobIds.length > 0) {
        handle.run(`update jobs set owner_label = ? where id in (${ownedJobMarks})`, ANONYMOUS_AUTHOR, ...ownedJobIds)
        if (hasTable(handle, "job_consents")) {
          handle.run(
            `update job_consents set owner_label = ? where job_id in (${ownedJobMarks})`,
            ANONYMOUS_AUTHOR,
            ...ownedJobIds,
          )
        }
      }
      handle.run(`update plugin_consents set owner_label = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      handle.run("update plugin_consents set consented_by = ? where consented_by = ?", ANONYMOUS_AUTHOR, user)
      handle.run(`update source_requests set owner_label = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      handle.run(`update plugin_requests set owner_label = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      handle.run(`update job_requests set owner_label = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      // A job consent names its owner on both sides: the person who granted it
      // and the person whose account it was granted for.
      if (hasTable(handle, "job_consents")) {
        handle.run("update job_consents set consented_by = ? where consented_by = ?", ANONYMOUS_AUTHOR, user)
      }
      // The collected items of a source they bound are their account's. Their
      // units' marks go with them, so no mark outlives the events it is about,
      // and the gate's verdicts on the items go with them too (lane 0198, review L).
      this.#dropMarksOf(
        handle,
        `where (source, account) in (select source, account from sources where owner_id in (${personMarks}) or (source, account) in (select source, account from source_requests where requested_by in (${personMarks})))`,
        [...personIds, ...personIds],
      )
      this.#dropTraitReadsOf(
        handle,
        `where (source, account) in (select source, account from sources where owner_id in (${personMarks}) or (source, account) in (select source, account from source_requests where requested_by in (${personMarks})))`,
        [...personIds, ...personIds],
      )
      handle.run(
        `delete from events where (source, account) in (select source, account from sources where owner_id in (${personMarks}) or (source, account) in (select source, account from source_requests where requested_by in (${personMarks})))`,
        ...personIds,
        ...personIds,
      )
      handle.run(`update sources set owner_id = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      if (ownedJobIds.length > 0) {
        handle.run(`update jobs set owner_id = ? where id in (${ownedJobMarks})`, ANONYMOUS_AUTHOR, ...ownedJobIds)
        if (hasTable(handle, "job_consents")) {
          handle.run(`update job_consents set owner_id = ? where job_id in (${ownedJobMarks})`, ANONYMOUS_AUTHOR, ...ownedJobIds)
        }
      }
      handle.run(`update jobs set owner_id = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      handle.run(`update job_requests set owner_id = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      if (hasTable(handle, "job_consents")) {
      }
      handle.run(`update plugin_consents set owner_id = ? where owner_id in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
      // The personal agent's name is `personal_<user id>`.
      handle.run("update records set author_agent = ? where author_agent = ?", ANONYMOUS_AUTHOR, `personal_${user}`)
      // A forget's purge entry holds keyed hashes; it names the author, so it
      // goes rather than being anonymised.
      handle.run("delete from forget_purges where author_user = ?", user)
      // On 0.11 the grant door keeps an audit row per act with a user id and a
      // device label.
      if (hasTable(handle, "act_audit")) {
        handle.run("update act_audit set user_id = ? where user_id = ?", ANONYMOUS_AUTHOR, user)
        handle.run("update act_audit set device = ? where user_id = ?", ANONYMOUS_AUTHOR, ANONYMOUS_AUTHOR)
      }
      // A stored version is a snapshot of the row, author included.
      const quote = JSON.stringify(user)
      const anon = JSON.stringify(ANONYMOUS_AUTHOR)
      for (const [from, to] of [
        [`"user":${quote}`, `"user":${anon}`],
        [`"owner":${quote}`, `"owner":${anon}`],
        // The personal agent's name is `personal_<user id>`, in the author
        // block or an older `author_agent` key.
        [`"author_agent":"personal_${user}"`, `"author_agent":${anon}`],
        [`"agent":"personal_${user}"`, `"agent":${anon}`],
      ]) {
        handle.run("update versions set snapshot = replace(snapshot, ?, ?) where snapshot like ?", from, to, `%${user}%`)
      }
      // Held writes, keyed-write ledgers, forgotten-copy keys, grants.
      handle.run("delete from held_batches where user_id = ?", user)
      handle.run("delete from write_receipts where user_id = ?", user)
      handle.run("delete from idempotent_writes where user_id = ?", user)
      handle.run("delete from forgotten_keys where author_user = ?", user)
      handle.run("delete from forgotten_prints where author_user = ?", user)
      handle.run("delete from act_grants where user_id = ?", user)
      // A preview's snapshot names the person who saw it, and may carry the
      // path or the version of what they were about to change: it goes with
      // them, unspent or spent, exactly as their grants do.
      handle.run("delete from act_previews where user_id = ?", user)
      handle.run("delete from agents_seen where user = ?", user)
      // What the forget left: a pin they made is theirs, and a remaining
      // statement or quote is scrubbed of their ids.
      if (hasTable(handle, "claims")) {
        if (hasTable(handle, "claim_pins")) {
          handle.run("delete from claim_pins where by_user = ?", user)
          handle.run("update claim_pins set by_user = ? where by_user = ?", ANONYMOUS_AUTHOR, upstream)
        }
        if (hasTable(handle, "claim_lines")) {
          for (const form of personIds) {
            handle.run(
              "update claim_lines set text = replace(text, ?, ?) where text like ?",
              form,
              ANONYMOUS_AUTHOR,
              `%${form}%`,
            )
          }
        }
        for (const form of personIds) {
          handle.run(
            "update claims set statement = replace(statement, ?, ?), quote = replace(quote, ?, ?) where statement like ? or quote like ?",
            form,
            ANONYMOUS_AUTHOR,
            form,
            ANONYMOUS_AUTHOR,
            `%${form}%`,
            `%${form}%`,
          )
        }
      }
      // A host they bound their plugins through is theirs: it goes, and no
      // other host row names them.
      if (hasTable(handle, "job_hosts")) handle.run("delete from job_hosts where user = ?", user)
      // A version records who saved it, and its spec and diff carry the owner's
      // account, id and display label: the row is the team's job, so its
      // authorship is anonymised by key (`owner.label` is a name, not the
      // handle, so matching a value would miss it).
      if (hasTable(handle, "job_versions")) {
        handle.run(`update job_versions set created_by = ? where created_by in (${personMarks})`, ANONYMOUS_AUTHOR, ...personIds)
        // By path, never by key name alone: only the owner's own fields are
        // theirs. Another person's spec, and a team label such as a channel
        // name, stay byte-identical.
        const scrub = (value, accountFor) => {
          if (Array.isArray(value)) return value.map((item) => scrub(item, accountFor))
          if (value && typeof value === "object") {
            const out = {}
            for (const [key, inner] of Object.entries(value)) {
              if (key === "account") out[key] = accountFor(String(inner))
              else if (key === "owner" && inner && typeof inner === "object" && !Array.isArray(inner)) {
                out[key] = { ...scrub(inner, accountFor), id: ANONYMOUS_AUTHOR, label: ANONYMOUS_AUTHOR }
              } else out[key] = scrub(inner, accountFor)
            }
            return out
          }
          if (typeof value === "string") {
            let text = value
            if (externalOwners.includes(value)) return ANONYMOUS_AUTHOR
            for (const form of personIds) text = text.split(form).join(ANONYMOUS_AUTHOR)
            for (const [account, pseudonym] of pseudonyms) text = text.split(account).join(pseudonym)
            return text
          }
          return value
        }
        // A diff is JSON patch: its entries name a path, so the owner's and the
        // account's patches are the ones that carry them.
        const scrubDiff = (value, accountFor) => {
          if (Array.isArray(value)) return value.map((item) => scrubDiff(item, accountFor))
          if (!value || typeof value !== "object") return value
          const out = {}
          for (const [key, inner] of Object.entries(value)) out[key] = scrubDiff(inner, accountFor)
          if (typeof value.path === "string" && "value" in value) {
            const path = value.path
            if (path === "/account") out.value = accountFor(String(value.value))
            else if (/^\/owner(\/(id|label))?$/.test(path)) {
              out.value =
                value.value && typeof value.value === "object" && !Array.isArray(value.value)
                  ? { ...value.value, id: ANONYMOUS_AUTHOR, label: ANONYMOUS_AUTHOR }
                  : ANONYMOUS_AUTHOR
            }
          }
          return out
        }
        const rows =
          ownedJobIds.length === 0
            ? []
            : handle.all(
                `select job_id, version, doc, diff from job_versions where job_id in (${ownedJobMarks})`,
                ...ownedJobIds,
              )
        for (const row of rows) {
          const accountOf = (text) => pseudonyms.get(text) ?? text
          let doc = row.doc
          let diff = row.diff
          try {
            doc = JSON.stringify(scrub(JSON.parse(row.doc), accountOf))
          } catch {
            // A spec that is not JSON is left as it is: no key to rewrite.
          }
          try {
            diff = JSON.stringify(scrubDiff(scrub(JSON.parse(row.diff), accountOf), accountOf))
          } catch {
            // A diff is a JSON patch; anything else names no key.
          }
          if (doc !== row.doc || diff !== row.diff) {
            handle.run(
              "update job_versions set doc = ?, diff = ? where job_id = ? and version = ?",
              doc,
              diff,
              row.job_id,
              row.version,
            )
          }
        }
      }
      // A run's cursors and error, and a log line's detail, quote what they
      // read: the person's own id goes with them.
      if (hasTable(handle, "job_runs")) {
        for (const column of ["cursor_before", "cursor_after", "error", "outcome"]) {
          handle.run(
            `update job_runs set ${column} = replace(${column}, ?, ?) where ${column} like ?`,
            user,
            ANONYMOUS_AUTHOR,
            `%${user}%`,
          )
        }
      }
      if (hasTable(handle, "job_logs")) {
        handle.run("update job_logs set detail = replace(detail, ?, ?) where detail like ?", user, ANONYMOUS_AUTHOR, `%${user}%`)
      }
      // Their proposals and requests wait no longer.
      const requests = Number(handle.run("delete from source_requests where requested_by = ?", user).changes)
      const proposals = Number(handle.run("delete from plugin_requests where requested_by = ?", user).changes)
      handle.run("delete from job_requests where requested_by = ?", user)
      // A routine's run is kept whole, up to 64 KiB of JSON: it quotes what it
      // read, so the person's id and their account go from it too.
      if (hasTable(handle, "runs")) {
        for (const [from, to] of [...personIds.map((form) => [form, ANONYMOUS_AUTHOR]), ...[...pseudonyms].map(([account, pseudonym]) => [account, pseudonym])]) {
          handle.run("update runs set run = replace(run, ?, ?) where run like ?", from, to, `%${from}%`)
        }
      }
      return { copies: copies.length, anonymised, requests, proposals }
    })
    const erase = this.#eraseFile()
    return { space: this.#spaceId, core, ...counts, erase }
  }

  /**
   * `person.eraseCore`: the person's own audit and knowledge rows, and nothing
   * else. It is the erasure's own step, so control can run it after the purge
   * and retry it on its own clock without repeating anything.
   */
  async personEraseCore(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "admin", "Erasing a person needs the admin or owner role in this space")
    if (a.erase !== true) {
      throw forbidden("Erasing a person needs the erase credential, not a records key.", "erase_forbidden")
    }
    const body = requireObject(input, "person.erase-core")
    // The id the gateway sends as `x-tdai-user-id`: control's `upstream_user_id`,
    // which is what the core stores. Control's own user id is never here.
    const upstream = text(body.upstream_user) ?? ""
    if (!upstream || !USER_ID_LIKE.test(upstream)) {
      throw invalid("invalid_user", "upstream_user must be the id the gateway sends.", "Send control's upstream_user_id as {upstream_user}.")
    }
    if (!this.#settings.personRows) return { configured: false }
    return { configured: true, erase_user: await this.#settings.personRows({ upstreamUserId: upstream }) }
  }

  /** space.purge: delete the space's file. `confirm` must repeat the team id. */
  async purge(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "admin", "Purging a space needs the admin or owner role")
    const body = requireObject(input, "space.purge")
    if (body.confirm !== this.#spaceId) {
      throw invalid("invalid_confirm", "confirm must repeat this space's id exactly.", "Send {confirm: \"<x-records-space>\"} once the person has agreed to delete everything in the space.")
    }
    this.#release(this.#spaceId)
    const file = this.#fileFor(this.#spaceId)
    const existed = fs.existsSync(file)
    for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(`${file}${suffix}`, { force: true })
    // Every file named for the space goes with it (review L1): the ready marker
    // the engine writes (`spaces/<id>.ready`) and the work marker a removal
    // leaves. A marker that outlives its file names a space nobody owns.
    clearReady(path.dirname(file), this.#spaceId)
    this.#settings.markWork(this.#spaceId, false)
    this.#settings.forgetMeta(this.#spaceId)
    return { deleted_file: existed }
  }

  // -------------------------------------------------------------------------
  // Forgotten-copy fingerprints (records/src/forgotten.js): what a forget
  // leaves so that recall withholds its kept copies from the person who
  // forgot. Keyed hashes only, one key per author; each author sees only
  // their own.

  /** The caller's key in this space, made on first use (inside a write). */
  #forgottenKey(handle, user, create) {
    const row = handle.get("select key from forgotten_keys where author_user = ?", user)
    if (row || !create) return row?.key ?? null
    const key = newForgottenKey()
    handle.run("insert into forgotten_keys (author_user, key, created) values (?, ?, ?)", user, key, this.#nowIso())
    return key
  }

  /**
   * forgotten.put: `{text, kind}`. The service extracts the copy features of
   * `text` itself (copyFeatures), hashes them with the caller's key, and keeps
   * neither the text nor anything readable. An equal fingerprint of the same
   * author is answered, not stored twice.
   */
  async putForgotten(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Forgetting needs the editor role in this space")
    const body = requireObject(input, "forgotten.put")
    const extra = Object.keys(body).filter((name) => !["text", "kind", "purge"].includes(name))
    if (extra.length > 0) throw invalid("invalid_fingerprint", `A fingerprint is made from the forgotten text; ${extra.join(", ")} is not accepted.`, "Send {text, kind}: the text that was forgotten and what it was.")
    if (body.purge !== undefined && typeof body.purge !== "boolean") throw invalid("invalid_fingerprint", "purge must be true or false.", "Send purge: true when the text was deleted somewhere this service cannot see (a learned fact), so clients purge it.")
    if (typeof body.text !== "string" || !body.text.trim() || body.text.length > MAX_TEXT_CHARS) {
      throw invalid("invalid_fingerprint", `text must be the forgotten text, 1 to ${MAX_TEXT_CHARS} characters.`, "Send {text, kind}.")
    }
    const kind = body.kind ?? "fact"
    if (!FORGOTTEN_KINDS.includes(kind)) throw invalid("invalid_fingerprint", `kind must be one of ${FORGOTTEN_KINDS.join(", ")}.`, "Send the forgotten memory's type, or atom.")
    // Validated before anything is written: a text with fewer than two copy
    // features (stop-words, boilerplate) can never match, so it is refused.
    if (!fingerprintOf(newForgottenKey(), body.text)) {
      throw invalid("invalid_fingerprint", "The text has no copy features: matchCopy needs two anchors or stems, and stop-words and boilerplate are neither.", "Nothing can be withheld for it; say so in the forget's report.")
    }
    const handle = this.#writer(a)
    // A purge entry for text deleted outside this service (a core atom), in
    // its own write: it stands even when the fingerprint is at its cap.
    const purgeId = body.purge === true ? handle.tx(() => this.#writePurge(handle, a.user, substantiveSentences({ title: body.text }))) : null
    const withPurge = (answer) => (purgeId ? { ...answer, purge_id: purgeId } : answer)
    return handle.tx(() => {
      const key = this.#forgottenKey(handle, a.user, true)
      const json = JSON.stringify(fingerprintOf(key, body.text))
      const digest = sha256(json)
      const existing = handle.get("select id, created from forgotten_prints where author_user = ? and digest = ?", a.user, digest)
      if (existing) return withPurge({ fingerprint: { id: existing.id, created: existing.created }, created: false })
      const mine = Number(handle.get("select count(*) as n from forgotten_prints where author_user = ?", a.user).n)
      if (mine >= MAX_PER_AUTHOR) {
        throw new RecordsError(413, "fingerprint_cap", `No room for another forgotten-copy fingerprint: you keep ${MAX_PER_AUTHOR} in this space.`, "The forget still deleted what it named. Its copies are not withheld until you lift old fingerprints in Memory's console (Memories › Forgotten).")
      }
      const id = `fp_${ulid(this.#settings.now().getTime())}`
      const created = this.#nowIso()
      handle.run("insert into forgotten_prints (id, author_user, digest, kind, created, fingerprint) values (?, ?, ?, ?, ?, ?)", id, a.user, digest, kind, created, json)
      return withPurge({ fingerprint: { id, created }, created: true })
    })
  }

  /**
   * forgotten.list: the caller's own key and fingerprints, oldest first. No
   * one else's: a fingerprint withholds only its author's rows, and another
   * member's key would let a reader test guesses against their hashes. The
   * console lists them by date, kind and space; nothing here is content.
   */
  async listForgotten(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reading forgotten-copy fingerprints needs a role in this space")
    requireObject(input, "forgotten.list")
    const handle = this.#reader()
    const key = this.#forgottenKey(handle, a.user, false)
    const rows = handle.all("select id, kind, created, fingerprint from forgotten_prints where author_user = ? order by created, id", a.user)
    return {
      version: FEATURE_VERSION,
      key,
      fingerprints: rows.map((row) => ({ id: row.id, kind: row.kind, created: row.created, ...parse(row.fingerprint, {}) })),
    }
  }

  /**
   * forgotten.match `{since?}` (docs/design/forget-erase.md, the purge
   * contract): the caller's own purge entries younger than the window, oldest
   * first, each `{id, created, expires, salt, lengths, hashes}`, so a client
   * can delete forgotten text from its own outbox. Salted hashes only, never
   * text, never a long-lived key, never another member's. `since` (an ISO
   * time) answers only entries created after it.
   */
  async matchForgotten(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reading purge entries needs a role in this space")
    const body = requireObject(input, "forgotten.match")
    const extra = Object.keys(body).filter((name) => name !== "since")
    if (extra.length > 0) throw invalid("invalid_request", `forgotten.match takes only since; ${extra.join(", ")} is not accepted.`, "Send {} or {since: \"<ISO time of the newest entry you hold>\"}.")
    if (body.since !== undefined && (typeof body.since !== "string" || !ISO_TIME.test(body.since) || Number.isNaN(Date.parse(body.since)))) {
      throw invalid("invalid_request", "since must be an ISO time, such as an entry's created.", "Send the created of the newest entry you hold, or leave since out.")
    }
    const nowIso = this.#nowIso()
    const answer = { version: PURGE_VERSION, window_days: PURGE_WINDOW_DAYS, now: nowIso, entries: [] }
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle || !a.user) return answer
    const since = body.since === undefined ? "" : new Date(body.since).toISOString()
    const rows = handle.all("select id, created, expires, salt, lengths, hashes from forget_purges where author_user = ? and expires > ? and created > ? order by created, id", a.user, nowIso, since)
    // Entries made under a secret keep no salt in the file. With the secret
    // gone, a new random salt per call would make them stop matching without
    // a word: refuse instead (docs/design/forget-erase.md).
    if (!this.#settings.forgetSecret && rows.some((row) => row.salt === null || row.salt === undefined)) {
      this.#settings.warnOnce?.("forget_secret_missing", "RECORDS_FORGET_SECRET is unset, but this space holds purge entries made under it: forgotten.match is refused until the same secret is set again.")
      throw new RecordsError(503, "forget_secret_missing", "The service's forget secret is not set, but this space holds purge entries made under it.", "Set RECORDS_FORGET_SECRET to the value it had; a new value cannot read them.")
    }
    answer.entries = rows.map((row) => ({
      id: row.id,
      created: row.created,
      expires: row.expires,
      salt: row.salt ?? purgeSalt(this.#settings.forgetSecret, this.#spaceId, row.id),
      lengths: parse(row.lengths, []),
      hashes: parse(row.hashes, []),
    }))
    return answer
  }

  /**
   * forgotten.check `{texts}` (FABLE records #7): which of up to 100 texts
   * copy one of the caller's own forgotten-copy fingerprints, matched here, so
   * a client can withhold them without holding the key. Answers
   * `{version, results: [{index, withhold}]}`; nothing is stored.
   */
  async checkForgotten(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Checking forgotten copies needs a role in this space")
    const body = requireObject(input, "forgotten.check")
    const texts = body.texts
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_CHECK_TEXTS || !texts.every((t) => typeof t === "string")) {
      throw invalid("invalid_request", `texts must list 1 to ${MAX_CHECK_TEXTS} strings.`, `Send {texts: ["…"]}; split a longer list into calls of ${MAX_CHECK_TEXTS}.`)
    }
    const handle = this.#handleFor(this.#spaceId, false)
    const key = handle && a.user ? this.#forgottenKey(handle, a.user, false) : null
    const prints = key ? handle.all("select id, fingerprint from forgotten_prints where author_user = ?", a.user).map((p) => ({ id: p.id, ...parse(p.fingerprint, {}) })) : []
    const matcher = authorMatcher(key, prints)
    return {
      version: FEATURE_VERSION,
      results: texts.map((text, index) => ({ index, withhold: matcher.size > 0 && matcher.matches(text.slice(0, MAX_CHECK_CHARS)).length > 0 })),
    }
  }

  /**
   * forgotten.lift: delete some of the caller's own fingerprints, so recall
   * shows their copies again. Only in a browser session of Memory's console
   * (the gateway sets `x-records-credential: session` after its cookie, CSRF
   * and Origin checks): every bearer credential (an API key, a connect token,
   * an agent token) is refused, so no agent can undo a forget. No one lifts
   * another member's.
   */
  async liftForgotten(input, actor) {
    const a = normalizeActor(actor)
    if (a.credential !== "session") {
      throw new RecordsError(403, "session_required", "Showing forgotten copies again is done by the person, in Memory's console (Memories › Forgotten), not with a key or token.", "Open Memory's console, Memories › Forgotten.")
    }
    requireRole(a, "editor", "Lifting a forgotten-copy fingerprint needs the editor role in this space")
    const body = requireObject(input, "forgotten.lift")
    if (!Array.isArray(body.ids) || body.ids.length === 0 || body.ids.length > 100 || !body.ids.every((id) => typeof id === "string" && FORGOTTEN_ID.test(id))) {
      throw invalid("invalid_request", "ids must list 1 to 100 fingerprint ids.", 'Send {ids: ["fp_…"]}.')
    }
    const handle = this.#existing(a)
    if (!handle) return { lifted: [], missing: [...new Set(body.ids)] }
    return handle.tx(() => {
      const lifted = []
      const missing = []
      for (const id of new Set(body.ids)) {
        // Another author's fingerprint is reported missing: its existence is theirs.
        const row = handle.get("select id from forgotten_prints where id = ? and author_user = ?", id, a.user)
        if (!row) missing.push(id)
        else lifted.push(id)
      }
      for (const id of lifted) handle.run("delete from forgotten_prints where id = ?", id)
      return { lifted, missing }
    })
  }

  // -------------------------------------------------------------------------
  // For the routines (store-only, no HTTP route; contract §2.4): the run
  // ledger, meta, and retention.

  /** Register only the resolved caller's agent, never an identity from the body. */
  async agentsSeen(_input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Registering an agent needs the editor role in this space")
    if (!a.agent || a.agent.length > 200) throw invalid("invalid_agent", "The caller has no valid agent id.", "Send the request through the gateway with a resolved agent.")
    const handle = this.#writer(a)
    const now = this.#nowIso()
    handle.run("insert into agents_seen (user, agent, first_seen, last_seen) values (?, ?, ?, ?) on conflict(user, agent) do update set last_seen = excluded.last_seen", a.user, a.agent, now, now)
    return { agent: handle.get("select user, agent, first_seen, last_seen from agents_seen where user = ? and agent = ?", a.user, a.agent) }
  }

  /**
   * Internal only (no HTTP route): which of a routine's items it may not
   * write. `{items: [{key?, refs?, texts?}]}` → `{exists, blocked: [{index,
   * why}]}`. The daily routine asks just before its write phase; `records.put`
   * and `records.append` check routine writes again (FABLE records #2).
   */
  async routineCheck(input, actor) {
    const a = normalizeActor(actor)
    if (a.user !== ROUTINE_USER && a.user !== JOBS_USER) throw forbidden("The routine check is internal to the service's runs.")
    const body = requireObject(input, "routine.check")
    const items = Array.isArray(body.items) ? body.items : []
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { exists: false, blocked: items.map((_, index) => ({ index, why: "space_gone" })) }
    const matcher = this.#forgottenMatcher(handle)
    const textKey = this.#forgetTextKey(handle, false)
    const blocked = []
    items.forEach((item, index) => {
      const texts = isPlainObject(item) && Array.isArray(item.texts) ? item.texts.map(String) : []
      const why = isPlainObject(item) ? this.#routineBlock(handle, { key: item.key, refs: Array.isArray(item.refs) ? item.refs : [], texts }, matcher) : null
      // A keyed hash of the skipped item's title, never its text: the run keeps it so the console can count skips.
      if (why) blocked.push({ index, why, hash: textKey && texts[0] ? textHash(textKey, normalWords(texts[0]).slice(0, TEXT_MAX_WORDS)) : null })
    })
    return { exists: true, blocked }
  }

  /**
   * The trait gate's holds (design §5.4, trust H5): the claims its classifier
   * could not answer wait here, with the claim exactly as the routine read it
   * and the ref it cites, so **any** later run retries it — the claim's own day
   * is long gone, and the event's text with it. A held claim is never filed and
   * never dropped. Internal to the routines: no RPC method.
   */
  async holdTraits(input, actor) {
    const a = normalizeActor(actor)
    if (a.user !== ROUTINE_USER && a.user !== JOBS_USER) throw forbidden("Trait holds are internal to the service's runs.")
    const body = requireObject(input, "trait.hold")
    const holds = Array.isArray(body.holds) ? body.holds : []
    const handle = this.#existing(a)
    if (!handle || holds.length === 0) return { held: 0, reaped: 0 }
    const now = this.#nowIso()
    return handle.tx(() => {
      // A hold whose event is gone (retention, or a person's forget) has nothing
      // left to retry, so it goes: the sweep is what bounds the table.
      let reaped = 0
      for (const row of handle.all("select key, ref from trait_holds")) {
        if (row.ref && handle.get("select 1 as hit from events where id = ?", row.ref)) continue
        handle.run("delete from trait_holds where key = ?", row.key)
        reaped += 1
      }
      let held = 0
      for (const hold of holds.slice(0, 2_000)) {
        if (!isPlainObject(hold)) continue
        const key = typeof hold.key === "string" ? hold.key.slice(0, 200) : ""
        const item = typeof hold.item === "string" ? hold.item.slice(0, 20_000) : ""
        if (!key || !item) continue
        // An attempt is counted only when the classifier was really called and
        // failed: a breaker that is open, or a cell with no model, makes no
        // attempt and leaves the counter alone (design §10.1).
        const attempted = hold.attempted === true ? 1 : 0
        handle.run(
          `insert into trait_holds (key, ref, item, refs, reason, attempts, attempted, created) values (?, ?, ?, ?, ?, ?, ?, ?)
           on conflict(key) do update set attempts = attempts + ?, reason = excluded.reason, refs = coalesce(excluded.refs, trait_holds.refs), attempted = coalesce(excluded.attempted, trait_holds.attempted)`,
          key,
          typeof hold.ref === "string" ? hold.ref.slice(0, 300) : null,
          item,
          typeof hold.refs === "string" ? hold.refs.slice(0, 20_000) : null,
          String(hold.reason ?? "").slice(0, 200),
          attempted,
          attempted ? now : null,
          now,
          attempted,
        )
        held += 1
      }
      return { held, reaped }
    })
  }

  /**
   * The claims waiting on the trait classifier, oldest first. Internal to the
   * routines. Every run reads this queue, so it also reaps it: a hold whose
   * event is gone (retention, or a person's forget) has nothing left to retry,
   * and the sweep here is what keeps the table bounded when no new hold is
   * written (design §5.4).
   */
  async listTraitHolds(input, actor) {
    const a = normalizeActor(actor)
    if (a.user !== ROUTINE_USER && a.user !== JOBS_USER) throw forbidden("Trait holds are internal to the service's runs.")
    const body = requireObject(input ?? {}, "trait.holds")
    const limit = Math.max(1, Math.min(Number(body.limit) || 200, 2_000))
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { holds: [] }
    const reaped = handle.tx(() => {
      let gone = 0
      for (const row of handle.all("select key, ref from trait_holds")) {
        // A ref is an event or a session turn. An event's hold goes when the
        // event is gone (retention, or a forget); a turn's when the person
        // forgot the turn. A turn the core still holds is not an event, and
        // that is not a reason to drop its claim (design §5.4).
        if (row.ref && this.#refAlive(handle, row.ref)) continue
        handle.run("delete from trait_holds where key = ?", row.key)
        gone += 1
      }
      return gone
    })
    return {
      holds: handle
        .all("select key, ref, item, refs, reason, attempts, attempted, created from trait_holds order by created, key limit ?", limit)
        .map((row) => ({ ...row, attempts: Number(row.attempts) || 0 })),
      total: Number(handle.get("select count(*) as n from trait_holds")?.n) || 0,
      reaped,
    }
  }

  /** A claim the gate cleared leaves the hold list. Internal to the routines. */
  async releaseTraits(input, actor) {
    const a = normalizeActor(actor)
    if (a.user !== ROUTINE_USER && a.user !== JOBS_USER) throw forbidden("Trait holds are internal to the service's runs.")
    const body = requireObject(input ?? {}, "trait.release")
    const keys = Array.isArray(body.keys) ? body.keys.filter((key) => typeof key === "string" && key).slice(0, 2_000) : []
    const handle = this.#existing(a)
    if (!handle || keys.length === 0) return { released: 0 }
    return handle.tx(() => {
      let released = 0
      for (const key of keys) released += Number(handle.run("delete from trait_holds where key = ?", key.slice(0, 200)).changes) || 0
      return { released }
    })
  }

  /** Internal only: all pairs are needed by shared-space routines. */
  async routineAgents(actor) {    const a = normalizeActor(actor)
    requireRole(a, "owner", "Reading the routine agent registry needs the owner role")
    if (a.user !== ROUTINE_USER) throw forbidden("The agent registry is internal to routines.", "Use agents.seen for your own agent.")
    return this.#reader().all("select user, agent from agents_seen order by user, agent").map((row) => ({ ...row }))
  }

  /**
   * agents.mine: the caller's own agent names in this space, most recently seen
   * first, from the registry capture fills (`agents.seen`). The filter is the
   * caller's own user id, so another member's names are never listed and the
   * routines' own registry (`routineAgents`) is not reachable here. A visitor
   * with only page grants has no roster: this needs a space role. At most
   * AGENTS_MINE_LIMIT names are answered, and `capped` says there were more.
   */
  async agentsMine(_input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reading your own agent names needs a role in this space")
    if (!a.user) throw forbidden("The caller has no user.", "Send the request through the gateway with a resolved user.")
    if (a.user === ROUTINE_USER) return { agents: [], capped: false }
    // One row beyond the page tells whether another name exists.
    const rows = this.#reader().all("select agent, first_seen, last_seen from agents_seen where user = ? order by last_seen desc, agent limit ?", a.user, AGENTS_MINE_LIMIT + 1)
    const capped = rows.length > AGENTS_MINE_LIMIT
    return {
      agents: rows.slice(0, AGENTS_MINE_LIMIT).map((row) => ({ agent: row.agent, first_seen: row.first_seen, last_seen: row.last_seen })),
      capped,
    }
  }

  /**
   * Internal only (no HTTP route): the tokens of this space's routine runs,
   * summed in SQL, for a `budget_day` (less `exclude`, a run id) or for runs
   * started at or after `since` (FABLE records #5).
   */
  async runTokens(input, actor) {
    const a = normalizeActor(actor)
    if (a.user !== ROUTINE_USER) throw forbidden("Run totals are internal to routines.")
    const body = requireObject(input, "runs.tokens")
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { tokens: 0 }
    const where = []
    const params = []
    if (typeof body.budget_day === "string") {
      where.push("budget_day = ?")
      params.push(body.budget_day)
    }
    if (typeof body.since === "string") {
      where.push("started >= ?")
      params.push(body.since)
    }
    if (typeof body.exclude === "string") {
      where.push("id <> ?")
      params.push(body.exclude)
    }
    const row = handle.get(`select coalesce(sum(coalesce(json_extract(run, '$.tokens'), 0)), 0) as tokens from runs${where.length ? ` where ${where.join(" and ")}` : ""}`, ...params)
    let tokens = Number(row?.tokens) || 0
    // The service-wide cap counts every ledger (0.11 review, should-fix 4): a
    // window asked with `since` includes what the jobs and the meeting-page
    // proposals spent, so no side escapes the ceiling. `budget_day` stays the
    // routines' own account, which is what a routine's run is charged against.
    if (typeof body.since === "string") {
      const jobs = handle.get("select coalesce(sum(coalesce(json_extract(counts, '$.tokens'), 0)), 0) as tokens from job_runs where started >= ?", body.since)
      const meetings = handle.get("select coalesce(sum(tokens), 0) as tokens from meeting_proposal_spend where at >= ?", body.since)
      // The engine's lane ledger is the cell's fourth term (S3b, design §6): the
      // service cap sees the shadow's spend, while the space's own day
      // (`modelTokens`) does not, so a shadow can never starve the daily.
      const engine = handle.get("select coalesce(sum(tokens), 0) as tokens from lane_ledger where at >= ?", body.since)
      tokens += (Number(jobs?.tokens) || 0) + (Number(meetings?.tokens) || 0) + (Number(engine?.tokens) || 0)
    }
    return { tokens }
  }

  /**
   * Internal only (no HTTP route): the tokens this space's model calls spent in
   * one window, from **both** ledgers — the routines' `runs` and the jobs'
   * `job_runs` — so the routines and the job runner share one day's budget
   * (records/src/model-guard.js). The window is the space's **local** day in
   * UTC, `[from, to)` (`routines/dates.js` `dayBounds`): a run at 21:00 in New
   * York is that day's, never the next UTC day's. The caller is one of the
   * service's system principals, never a person.
   */
  async modelTokens(input, actor) {
    const a = normalizeActor(actor)
    if (!SYSTEM_USERS.has(a.user)) throw forbidden("Model totals are internal to the service's routines and jobs.")
    const body = requireObject(input, "model.tokens")
    if (typeof body.from !== "string" || !body.from || typeof body.to !== "string" || !body.to) {
      throw invalid("invalid_window", "from and to are required.", 'Send {from: "2026-11-12T05:00:00.000Z", to: "2026-11-13T05:00:00.000Z"}: the local day in UTC.')
    }
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { routines: 0, jobs: 0, meetings: 0, tokens: 0 }
    const routines = handle.get("select coalesce(sum(coalesce(json_extract(run, '$.tokens'), 0)), 0) as tokens from runs where started >= ? and started < ?", body.from, body.to)
    const jobs = handle.get("select coalesce(sum(coalesce(json_extract(counts, '$.tokens'), 0)), 0) as tokens from job_runs where started >= ? and started < ?", body.from, body.to)
    // Proposing from a meeting page spends the same day (0.11): the budget the
    // routines and the jobs share counts it, so neither can spend it twice.
    const meetings = handle.get("select coalesce(sum(tokens), 0) as tokens from meeting_proposal_spend where at >= ? and at < ?", body.from, body.to)
    const routinesTokens = Number(routines?.tokens) || 0
    const jobsTokens = Number(jobs?.tokens) || 0
    const meetingTokens = Number(meetings?.tokens) || 0
    return { routines: routinesTokens, jobs: jobsTokens, meetings: meetingTokens, tokens: routinesTokens + jobsTokens + meetingTokens }
  }

  /**
   * What the *catch-up* runs of one local day spent, in tokens: the part of a
   * day's budget set aside for the backlog, so it stays at most its share
   * however many ticks run (review finding H5). Internal to the routines.
   */
  async catchUpTokens(input, actor) {
    const a = normalizeActor(actor)
    if (!SYSTEM_USERS.has(a.user)) throw forbidden("Model totals are internal to the service's routines and jobs.")
    const body = requireObject(input, "runs.catchUpTokens")
    if (typeof body.from !== "string" || !body.from || typeof body.to !== "string" || !body.to) throw invalid("invalid_window", "from and to are required.", 'Send {from: "2026-11-12T05:00:00.000Z", to: "2026-11-13T05:00:00.000Z"}: the local day in UTC.')
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { tokens: 0, runs: 0 }
    const row = handle.get(
      "select coalesce(sum(coalesce(json_extract(run, '$.tokens'), 0)), 0) as tokens, count(*) as runs from runs where started >= ? and started < ? and json_extract(run, '$.catch_up') = 1",
      body.from,
      body.to,
    )
    return { tokens: Number(row?.tokens) || 0, runs: Number(row?.runs) || 0 }
  }

  /** putRun: upsert a routine run by `run.id`; the run is kept whole. */
  async putRun(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "editor", "Recording a routine run needs the editor role in this space")
    const body = requireObject(input, "putRun")
    const run = body.run
    if (!isPlainObject(run) || typeof run.id !== "string" || !run.id || run.id.length > 200) {
      throw invalid("invalid_run", "A run needs an id.", "Send {run: {id, routine, date, status, started, …}}.")
    }
    const json = JSON.stringify(redactedRun(run))
    if (json.length > 64 * 1024) throw tooLarge("The run is larger than 64 KiB.", "Keep a run's detail short; put the long text in the journal.")
    const handle = this.#writer(a)
    handle.tx(() => {
      const existing = handle.get("select seq from runs where id = ?", run.id)
      const seq = existing ? Number(existing.seq) : Number(handle.get("select coalesce(max(seq), 0) + 1 as n from runs").n)
      handle.run(
        "insert or replace into runs (id, seq, routine, date, budget_day, status, started, run) values (?, ?, ?, ?, ?, ?, ?, ?)",
        run.id,
        seq,
        text(run.routine),
        text(run.date),
        text(run.budget_day),
        text(run.status),
        text(run.started),
        json,
      )
    })
    return { run }
  }

  /**
   * The read marks of one local day: one `{key, fingerprint}` per unit the
   * model read. Internal to the routines (no HTTP route): the daily compares
   * them with the day's units, so a re-run reads only what is new or changed
   * (FINDINGS R6). A space with no mark is an empty list, never an error.
   */
  async unitReads(input, actor) {
    const a = normalizeActor(actor)
    if (!SYSTEM_USERS.has(a.user)) throw forbidden("Read marks are internal to the routines.")
    const body = requireObject(input, "unitReads")
    const day = requireDay(body.day)
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { reads: [] }
    const reads = handle.all("select unit_key as key, fingerprint from unit_reads where day = ? order by unit_key", day)
    return { reads }
  }

  /**
   * Record one run's read marks for a local day, one row per unit: an upsert,
   * so a batch read twice (a crash between the call and the next run) leaves
   * one row. The daily writes them only after a batch succeeded, so a refused
   * or failed batch leaves its units unread. Internal to the routines.
   */
  async markUnitsRead(input, actor) {
    const a = normalizeActor(actor)
    if (!SYSTEM_USERS.has(a.user)) throw forbidden("Read marks are internal to the routines.")
    const body = requireObject(input, "markUnitsRead")
    const day = requireDay(body.day)
    const units = Array.isArray(body.units) ? body.units : null
    if (!units) throw invalid("invalid_request", "units must be an array.", "Send units as [{key, fingerprint}, …].")
    if (units.length > 5000) throw tooLarge("At most 5000 units per call.", "Send the run's units in smaller calls.")
    const rows = units.map((unit) => {
      if (!isPlainObject(unit) || typeof unit.key !== "string" || !unit.key || unit.key.length > 300) throw invalid("invalid_request", "Each unit needs a key.", "Send units as [{key, fingerprint}, …].")
      if (typeof unit.fingerprint !== "string" || !/^[0-9a-f]{8,64}$/.test(unit.fingerprint)) throw invalid("invalid_request", "Each unit needs a fingerprint.", "Send the fingerprint the unit was read with.")
      return { key: unit.key, fingerprint: unit.fingerprint }
    })
    const handle = this.#writer(a)
    const readAt = this.#nowIso()
    const runId = typeof body.run === "string" ? body.run.slice(0, 200) : null
    handle.tx(() => {
      for (const row of rows) {
        handle.run(
          "insert into unit_reads (day, unit_key, fingerprint, run_id, read_at) values (?, ?, ?, ?, ?) on conflict(day, unit_key) do update set fingerprint = excluded.fingerprint, run_id = excluded.run_id, read_at = excluded.read_at",
          day,
          row.key,
          row.fingerprint,
          runId,
          readAt,
        )
      }
    })
    return { marks: rows.length }
  }

  /**
   * The trait gate's verdicts for one local day (lane 0198): one `{key, verdict}`
   * per text the classifier judged, where `verdict` is `kept` or the category it
   * dropped. Internal to the routines (no HTTP route): a later run of the day
   * asks the classifier only about what this does not hold. A space with no row
   * is an empty list, never an error.
   */
  async traitReads(input, actor) {
    const a = normalizeActor(actor)
    if (!SYSTEM_USERS.has(a.user)) throw forbidden("Gate verdicts are internal to the routines.")
    const body = requireObject(input, "traits.reads")
    const day = requireDay(body.day)
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { reads: [] }
    return { reads: handle.all("select key, verdict from trait_reads where day = ? order by key", day) }
  }

  /**
   * Record one run's gate verdicts for a local day: an upsert per key, written
   * only for text the classifier really answered. `refs` names the sources the
   * text was read for, so a forget deletes the verdict with them (lane 0198
   * review L). A day keeps at most `TRAIT_READS_PER_DAY` verdicts, newest first,
   * so one long day cannot grow the file without bound; the rows expire with the
   * events they are about. Internal to the routines.
   */
  async markTraitReads(input, actor) {
    const a = normalizeActor(actor)
    if (!SYSTEM_USERS.has(a.user)) throw forbidden("Gate verdicts are internal to the routines.")
    const body = requireObject(input, "traits.reads")
    const day = requireDay(body.day)
    const reads = Array.isArray(body.reads) ? body.reads : null
    if (!reads) throw invalid("invalid_request", "reads must be an array.", "Send reads as [{key, verdict}, …].")
    if (reads.length > 5000) throw tooLarge("At most 5000 verdicts per call.", "Send the run's verdicts in smaller calls.")
    const rows = reads.map((read) => {
      if (!isPlainObject(read) || typeof read.key !== "string" || !read.key || read.key.length > 300) throw invalid("invalid_request", "Each verdict needs a key.", "Send reads as [{key, verdict}, …].")
      if (typeof read.verdict !== "string" || !read.verdict || read.verdict.length > 40) throw invalid("invalid_request", "Each verdict needs its answer.", "Send reads as [{key, verdict}, …].")
      if (read.refs !== undefined && !Array.isArray(read.refs)) throw invalid("invalid_request", "refs must be a list.", "Send refs as [\"evt_…\"], or leave it out.")
      const refs = (read.refs ?? []).filter((ref) => typeof ref === "string" && ref).slice(0, 50)
      return { key: read.key, verdict: read.verdict, refs: JSON.stringify(refs) }
    })
    const handle = this.#writer(a)
    const readAt = this.#nowIso()
    handle.tx(() => {
      for (const row of rows) {
        handle.run(
          "insert into trait_reads (day, key, verdict, refs, read_at) values (?, ?, ?, ?, ?) on conflict(day, key) do update set verdict = excluded.verdict, refs = excluded.refs, read_at = excluded.read_at",
          day,
          row.key,
          row.verdict,
          row.refs,
          readAt,
        )
      }
      handle.run(
        "delete from trait_reads where day = ? and key not in (select key from trait_reads where day = ? order by read_at desc, key desc limit ?)",
        day,
        day,
        TRAIT_READS_PER_DAY,
      )
    })
    return { reads: rows.length }
  }

  /** listRuns: newest first by `started`; on a tie, the run first written last comes first. */
  async listRuns(input, actor) {
    const a = normalizeActor(actor)
    requireRole(a, "viewer", "Reading routine runs needs a role in this space")
    const body = requireObject(input, "listRuns")
    const limit = intInRange(body.limit, "limit", 1, 200, 50)
    const where = []
    const params = []
    for (const key of ["routine", "date", "budget_day", "status"]) {
      if (body[key] === undefined || body[key] === null) continue
      if (typeof body[key] !== "string") throw invalid("invalid_request", `${key} must be text.`, `Send ${key} as a string, or leave it out.`)
      where.push(`${key} = ?`)
      params.push(body[key])
    }
    const rows = this.#reader().all(`select run from runs ${where.length ? `where ${where.join(" and ")}` : ""} order by started desc, seq desc limit ?`, ...params, limit)
    return { runs: rows.map((row) => redactedRun(parse(row.run, {}))) }
  }

  /**
   * The space's meta for the routines: `{space, team, space_kind, owner_user,
   * service}`: its container and the core's service id (for reading turns
   * from the core), its kind, and a personal space's owner (the core's
   * `user_id`). Nulls before the first write.
   */
  async meta() {
    return this.#readMeta(this.#spaceId) ?? metaOf(this.#spaceId, [])
  }

  /** Run retention now: drop expired events and proposals. Returns the counts. */
  /**
   * One bounded slice of the work a removal left behind, for the records
   * service's own timer (0.11 review R7): finish the citation index if it is
   * incomplete, then drain the pending retractions of this space's bindings.
   * Both are time-budgeted, and the answer says whether any work remains, so the
   * worker's marker is exact.
   */
  async workSlice({ budgetMs } = {}) {
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { work: false, records: 0, pending: 0 }
    const nowIso = this.#nowIso()
    const sliceMs = budgetMs === undefined ? this.#settings.drainSliceMs() : budgetMs
    const answer = handle.tx(() => {
      this.#citeBackfill(handle, { budgetMs: sliceMs })
      const indexing = (handle.get("select value from meta where key = 'cite_edges'")?.value ?? "") !== "done"
      let records = 0
      if (!indexing) {
        const deadline = this.#settings.clock() + sliceMs
        const system = { user: ROUTINE_USER, agent: ROUTINE_USER, role: "owner", space: this.#spaceId }
        for (const row of handle.all("select distinct source, account from events where retract_pending = 1")) {
          if (records > 0 && this.#settings.clock() > deadline) break
          const done = this.#drainPending(handle, system, { source: row.source, account: row.account, nowIso, budgetMs: Math.max(1, deadline - this.#settings.clock()), deadline })
          records += done.records
        }
      }
      const pending = Number(handle.get("select count(*) as n from events where retract_pending = 1")?.n ?? 0)
      return { work: pending > 0 || indexing, records, pending }
    })
    // A worker drain scrubs text too, so it truncates the WAL the ingest path
    // truncates; otherwise the words stay in `<space>.db-wal` (0.11 review R8-B1).
    if (answer.records > 0) {
      handle.erasePending = true
      if (handle.file) this.#truncateWal(handle)
    }
    return answer
  }

  /**
   * A forget a crash or a restart left half done finishes here (review L2): its
   * pending row holds the input, and each slice is its own transaction, so the
   * pass yields between them. The switch is forced on for a forget that has
   * already begun: like an erasure, it is never cancelled by turning the log
   * off, and its rows would otherwise hold a forgotten ref forever.
   */
  async #resumeForgets(handle) {
    if (!hasTable(handle, "claim_forget_pending")) return 0
    let resumed = 0
    for (const row of pendingForgets(handle)) {
      await drainForget(handle, { pendingId: row.id }, { env: { RECORDS_CLAIMS: "on" } })
      resumed += 1
    }
    return resumed
  }

  async maintain() {
    const handle = this.#handleFor(this.#spaceId, false)
    if (!handle) return { events: 0, proposals: 0, receipts: 0 }
    // A pending forget is drained here, and the drain awaits with the handle in
    // scope: the space is acquired for the whole pass (review M5).
    const held = this.#settings.acquireSpace?.(this.#spaceId)
    try {
      handle.maintainedAt = this.#settings.now().getTime()
      const answer = this.#maintain(handle)
      const forgets = await this.#resumeForgets(handle)
      return forgets > 0 ? { ...answer, forgets } : answer
    } finally {
      held?.release()
    }
  }
}

/** True for an error the store raised on purpose (it carries status, code, message, next). */
export function isRecordsError(error) {
  return error instanceof RecordsError
}
