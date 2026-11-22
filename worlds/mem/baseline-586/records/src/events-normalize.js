/**
 * One collected event, normalised for storage (the shape `events` holds).
 *
 * Extracted from the store's private `#normalizeEvent` so Memory's job runner
 * (records/src/jobs) can stage the same events in the same way as
 * `events.ingest`: one implementation, one set of limits, one secret refusal.
 * A collected event is an import: one that holds a secret is refused (owner
 * decision D3), and the text is clipped to the event limits (DESIGN §2.2).
 *
 * **The kinds are the shared contract's, not a list of Memory's own.** The
 * contract (v0.3.0) accepts eleven kinds and every `x-<plugin>/<kind>`
 * extension; a store with nine of them refused `file` and every extension —
 * `jelly.files`, `jelly.routine-runs` and Memory's own `x-mem/suggestion` —
 * while the collector's cursor advanced past them (DESIGN-jelly-sources §0.2,
 * §2.3.1). The rule here is the vendored package's own `isEventKind`, so the
 * store cannot drift from the contract it consumes.
 *
 * **The metadata v0.3.0 adds is kept, not acted on.** An actor's `kind`,
 * `identities` and `self` stay in the actor, and an event's `reply_to`,
 * `audience`, `domains`, `sections`, `parts` and `facts[]` are kept in the row
 * (`events.meta`), so a page the contract allows is never refused or stripped
 * here. Filing a fact, reading a hint or running a routine is later work.
 */
import { createHash } from "node:crypto"
import { sha256 } from "./ids.js"
import { storable } from "./storable.js"
import { EVENT_KINDS, EVENT_LIMITS, isEventKind } from "./vendor/source-contract/events.js"

export { EVENT_KINDS }

/**
 * A new event that says it happens more than this far ahead is refused at
 * ingest (lane 0197). A source's unbounded first read can expand a weekly
 * series years into the future: production's `gws.calendar` carried 2,610
 * instances from 2040. The store's ingest and the job checkpoint share this
 * one rule and one sentence, so neither path can drift from the other. An
 * event already stored is never re-judged: a duplicate or a removal of it is
 * handled first, and nothing already stored is deleted.
 */
export const FUTURE_EVENT_DAYS = 30
export const FUTURE_EVENT_LIMIT_MS = FUTURE_EVENT_DAYS * 86_400_000
export const FUTURE_EVENT_REASON = `occurs more than ${FUTURE_EVENT_DAYS} days ahead`

/**
 * Whether an event's occurrence is further ahead than the window allows.
 * @param {string | number} occurredAt an ISO time or milliseconds
 * @param {string | number} now an ISO time or milliseconds
 * @returns {boolean}
 */
export function isFarFuture(occurredAt, now) {
  const at = typeof occurredAt === "number" ? occurredAt : Date.parse(occurredAt)
  const from = typeof now === "number" ? now : Date.parse(now)
  return Number.isFinite(at) && Number.isFinite(from) && at - from > FUTURE_EVENT_LIMIT_MS
}

const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value)

/** The package whose events may name an OpenCode session (DESIGN §15.1, B8). */
export const HISTORY_PACKAGE = "@joe-broadhead/opencode-history"

/**
 * The OpenCode session an event names, or null (DESIGN §15.1, B8). Read from
 * the event's own `thread` field, never from its text: the History plugin's
 * `history-session:<rootID>` (its `toEvent`, `dist/index.js`), and the design's
 * `history:session:<sessionID>` spelling of the same key.
 *
 * Only **History's own events** may name a session: the binding's package is
 * the gate, so no other source can claim a session's curation by writing a
 * thread that looks like History's.
 *
 * @param {unknown} event
 * @param {string | null | undefined} packageName the binding's package
 * @returns {string | null}
 */
export function sessionIdOf(event, packageName) {
  if (packageName !== HISTORY_PACKAGE) return null
  const thread = isPlainObject(event) && typeof event.thread === "string" ? event.thread : ""
  const match = /^history[-:]session:(.+)$/.exec(thread)
  const id = match ? match[1].trim() : ""
  return id === "" ? null : id.slice(0, 300)
}

/** The fields v0.3 adds to an event, and to its hash when present (#46 §2, §3, §6). */
export const EVENT_METADATA_KEYS = Object.freeze(["reply_to", "audience", "domains", "sections", "parts", "facts"])

/** The package's `stable`: object keys sorted, `undefined` left out, arrays mapped. */
function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value).filter((key) => value[key] !== undefined)
    return Object.fromEntries(entries.sort().map((key) => [key, stable(value[key])]))
  }
  return value
}

/**
 * An actor as v0.3 hashes it: `[role, id, name]`, and the optional metadata as
 * one more element only when the page carries any — so an actor without it
 * hashes exactly as in v0.2 (contract §6).
 */
function hashedActor(actor) {
  const base = [actor.role, actor.id, actor.name ?? null]
  const extra = stable({ kind: actor.kind, identities: actor.identities, self: actor.self })
  return Object.keys(extra).length === 0 ? base : [...base, extra]
}

/**
 * The contract's `eventHash`: `sha256:` and the hash of `[source, account,
 * external_id, kind, occurred_at, thread, actors, title, text, url, labels]`,
 * the package's own order, over the event's **own** fields exactly as the page
 * sent them — its `source` (`gmail`), never the binding's (`gws.gmail`), and
 * its `occurred_at` as sent, never re-serialised. v0.3 appends each of
 * `reply_to`, `audience`, `domains`, `sections`, `parts` and `facts` as
 * `[key, value]` when the page carries it, and gives an actor's `kind`,
 * `identities` and `self` their own sorted object, so a v0.2 event hashes
 * exactly as it did (contract §6). Records carries no copy of the package, so
 * the formula lives here, as `descriptorHash` does for descriptors; a page
 * carries its hash, and Memory stores it once this recomputation agrees (D2).
 *
 * @param {object} event the event as delivered
 * @returns {string}
 */
export function contractEventHash(event) {
  const fields = [
    event.source,
    event.account,
    event.external_id,
    event.kind,
    event.occurred_at,
    event.thread ?? null,
    (Array.isArray(event.actors) ? event.actors : []).map(hashedActor),
    event.title ?? null,
    event.text ?? null,
    event.url ?? null,
    Array.isArray(event.labels) ? event.labels : [],
  ]
  for (const key of EVENT_METADATA_KEYS) {
    if (event[key] !== undefined) fields.push([key, stable(event[key])])
  }
  return `sha256:${sha256(JSON.stringify(fields))}`
}

/**
 * The content hash the engine re-enters on (S3a, design §10.1 and §12 decision
 * 8): the first **16 bytes** of `sha256` over the event's **text, title, actors
 * and `meta.facts`**, and never its labels. A relabelled item is the same
 * content, so it keeps its seq and is not read twice; a new title, text, actor
 * or fact is new content, and the ingest may give it a new seq while the day's
 * re-entry count allows one.
 *
 * **Sixteen bytes, and not the seventy-one characters of a hex digest.** The
 * engine's columns are added to every event row, and the ingest benchmark
 * (`records/scripts/engine-ingest-bench.mjs`) showed that the row's width is
 * what those columns cost: a hex string spends 55 more bytes on every event of
 * a space for nothing. A 128-bit digest is what `unitFingerprint` already
 * truncates to, and a false "unchanged" would need two contents of one space to
 * collide, which is not a risk at 10^4 items a day. It is stored as a blob, so
 * the column holds 16 bytes and not 32 hex characters.
 *
 * It is not the contract's `eventHash` (above): that one is defined by the
 * contract, covers every field, and decides whether a page is a repeat at all.
 * This one decides whether the *content* the engine reads has changed.
 *
 * The parts are written as one canonical string rather than through a deep clone
 * of the event: the ingest hashes every event of every page, and the event is
 * already normalised (actors and identities in a fixed order, facts as the
 * source gave them, their keys sorted here).
 *
 * @param {object} event a normalised event (the shape `events` holds)
 * @returns {Buffer} 16 bytes
 */
export function contentHash(event) {
  const actors = Array.isArray(event?.actors) ? event.actors : []
  const facts = Array.isArray(event?.meta?.facts) ? event.meta.facts : []
  const parts = [event?.text ?? "", event?.title ?? ""]
  for (const actor of actors) {
    parts.push(
      `${actor?.role ?? ""}\u0000${actor?.id ?? ""}\u0000${actor?.name ?? ""}\u0000${actor?.kind ?? ""}\u0000${actor?.self ?? ""}\u0001${JSON.stringify(actor?.identities ?? [])}`,
    )
  }
  for (const fact of facts) parts.push(isPlainObject(fact) ? canonicalFlat(fact) : JSON.stringify(fact ?? null))
  return createHash("sha256").update(parts.join("\u0002")).digest().subarray(0, CONTENT_HASH_BYTES)
}

/** The bytes a content hash keeps. */
export const CONTENT_HASH_BYTES = 16

/**
 * Whether two stored content hashes are the same content. A row an older build
 * wrote has none, and a row this branch's first build wrote holds a hex string;
 * both compare as what they are, so a file is never misread as changed because
 * the hash changed shape.
 */
export function sameHash(a, b) {
  const hex = (value) => {
    if (value === null || value === undefined) return null
    if (typeof value === "string") return value.startsWith("sha256:") ? value.slice(7, 39) : value
    return Buffer.from(value).toString("hex").slice(0, CONTENT_HASH_BYTES * 2)
  }
  const left = hex(a)
  const right = hex(b)
  return left !== null && right !== null && left === right
}

/** One flat object with its keys sorted, and its values as the contract gave them. */
function canonicalFlat(value) {
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${JSON.stringify(value[key])}`).join(",")}}`
}

/**
 * The event metadata v0.3 adds, as the store keeps it (#46 §2, §3): the six
 * keys, each cut to its contract limit and nothing else changed. `undefined`
 * when the event carries none, so a v0.2 event's row holds no metadata at all.
 *
 * @param {object} event the event as delivered
 * @returns {object | null}
 */
export function eventMetadata(event) {
  const cut = (value, max) => (typeof value === "string" ? value.slice(0, max) : null)
  const meta = {}
  if (typeof event.reply_to === "string") meta.reply_to = cut(event.reply_to, EVENT_LIMITS.replyTo)
  if (typeof event.audience === "string") meta.audience = cut(event.audience, 40)
  if (Array.isArray(event.domains) && event.domains.length > 0) {
    meta.domains = event.domains.filter((domain) => typeof domain === "string").slice(0, EVENT_LIMITS.domains).map((domain) => domain.slice(0, EVENT_LIMITS.domain))
  }
  if (Array.isArray(event.sections) && event.sections.length > 0) {
    meta.sections = event.sections
      .filter(isPlainObject)
      .slice(0, EVENT_LIMITS.sections)
      .map((section) => ({ heading: cut(section.heading, EVENT_LIMITS.sectionHeading) ?? "", text: cut(section.text, EVENT_LIMITS.text) ?? "" }))
  }
  if (Array.isArray(event.parts) && event.parts.length > 0) {
    meta.parts = event.parts
      .filter(isPlainObject)
      .slice(0, EVENT_LIMITS.parts)
      .map((part) => ({
        id: cut(part.id, EVENT_LIMITS.partId) ?? "",
        text: cut(part.text, EVENT_LIMITS.text) ?? "",
        ...(typeof part.actor === "string" ? { actor: part.actor.slice(0, EVENT_LIMITS.actorId) } : {}),
      }))
  }
  if (Array.isArray(event.facts) && event.facts.length > 0) {
    // A fact is a closed, typed object the source holds in code; it is kept as
    // given. Nothing here acts on one: filing facts is a later slice.
    meta.facts = event.facts.filter(isPlainObject).slice(0, EVENT_LIMITS.facts).map((fact) => ({ ...fact }))
  }
  return Object.keys(meta).length === 0 ? null : meta
}

/** The metadata's own words, for the secret screen: sections, parts and a fact's title. */
function metadataWords(meta) {
  if (meta === null) return []
  return [
    ...(meta.sections ?? []).map((section) => `${section.heading}\n${section.text}`),
    ...(meta.parts ?? []).map((part) => part.text),
    ...(meta.facts ?? []).map((fact) => (typeof fact.title === "string" ? fact.title : "")),
  ].filter(Boolean)
}

/** The metadata keys a hash covers, and only those the event carries. */
function metadataOf(event) {
  const kept = {}
  for (const key of EVENT_METADATA_KEYS) if (event[key] !== undefined) kept[key] = event[key]
  return kept
}

/**
 * @param {unknown} event
 * @param {{source: string, account: string}} own the binding the event arrived on
 * @returns {{event: object} | {error: string}}
 */
export function normalizeEvent(event, own) {
  if (!isPlainObject(event)) return { error: "not an object" }
  const externalId = typeof event.external_id === "number" ? String(event.external_id) : event.external_id
  // The id's own limit is the contract's, imported rather than repeated: a
  // second literal is how a store comes to hold 512 and refuse 100.
  if (typeof externalId !== "string" || !externalId || externalId.length > EVENT_LIMITS.externalId) return { error: `external_id is missing or longer than ${EVENT_LIMITS.externalId} characters` }
  if (!isEventKind(event.kind)) return { error: `kind is not one of ${EVENT_KINDS.join(", ")}, or x-<plugin>/<kind>` }
  const occurred = typeof event.occurred_at === "string" ? Date.parse(event.occurred_at) : Number.NaN
  if (Number.isNaN(occurred)) return { error: "occurred_at is not a date-time" }
  const text = (value, max) => (value === undefined || value === null ? null : String(value).slice(0, max))
  const actors = Array.isArray(event.actors)
    ? event.actors
        .filter(isPlainObject)
        .slice(0, 20)
        .map((actor) => ({
          role: text(actor.role, 40),
          id: text(actor.id, 300),
          name: text(actor.name, 200),
          // v0.3's actor metadata (#46 §1), kept as the plugin gave it. An empty
          // identities list says nothing, so it is left out.
          ...(actor.kind === undefined ? {} : { kind: text(actor.kind, 40) }),
          ...(Array.isArray(actor.identities) && actor.identities.length > 0
            ? { identities: actor.identities.filter(isPlainObject).slice(0, 10).map((identity) => ({ id: text(identity.id, 300), strength: text(identity.strength, 40), basis: text(identity.basis, 64) })) }
            : {}),
          // A plugin's `self: false` is the one hint Memory keeps as given
          // (design §6): it can only take the person's word away, never give it.
          // `self: true` is dropped here, so nothing downstream can be upgraded
          // by it, and the self rule reads the id and the console's identities.
          ...(actor.self === false ? { self: false } : {}),
        }))
    : []
  const labels = Array.isArray(event.labels) ? event.labels.slice(0, 20).map((label) => String(label).slice(0, 100)) : []
  const url = typeof event.url === "string" && /^https?:\/\//i.test(event.url) ? event.url.slice(0, 2048) : null
  const meta = eventMetadata(event)
  const normal = {
    external_id: externalId,
    kind: event.kind,
    occurred_at: new Date(occurred).toISOString(),
    thread: text(event.thread, 512),
    actors,
    title: text(event.title, 300),
    text: text(event.text, 4096),
    url,
    labels,
    ...(meta === null ? {} : { meta }),
  }
  // A collected event is an import: one that holds a secret is refused (owner decision D3).
  // The long fields v0.3 adds are the event's words too, so they are screened beside
  // its title and text: a secret is never laundered in through a section or a part.
  const words = [normal.title, normal.text, ...metadataWords(meta)].filter(Boolean).join("\n")
  const verdict = storable(words, "import")
  if (verdict.outcome === "refuse") return { error: `holds a secret (${verdict.secrets.join(", ")}); secrets are never stored` }
  // The hash is the library's, over the event's own fields as delivered; the binding's source and account
  // only stand in when an event names neither (a caller that is not a contract page).
  const source = typeof event.source === "string" && event.source ? event.source : own?.source
  const account = typeof event.account === "string" && event.account ? event.account : own?.account
  if (typeof source !== "string" || typeof account !== "string") return { error: "the event arrived without its source and account" }
  const expected = contractEventHash({
    source,
    account,
    external_id: externalId,
    kind: event.kind,
    occurred_at: event.occurred_at,
    thread: event.thread ?? null,
    actors: event.actors,
    title: event.title ?? null,
    text: event.text ?? null,
    url: event.url ?? null,
    labels: event.labels,
    ...metadataOf(event),
  })
  if (typeof event.hash === "string" && event.hash !== "") {
    // A page carries its hash, and a hash that is not the eventHash of its own fields is refused, never
    // silently replaced. The collector's `read()` refuses such a page whole (the contract's shape check,
    // before ingest); here the page has already been read by a caller, so only this event is refused and
    // the page's good events still land.
    if (event.hash !== expected) return { error: "its hash is not the eventHash of its own fields" }
    normal.hash = event.hash
  } else {
    normal.hash = expected
  }
  return { event: normal }
}
