// @we-the-rebel-alliance/source-contract 0.3.0. Built by scripts/build.mjs; do not edit.
import {
  MAX_CURSOR_LENGTH,
  canonicalScope
} from "./chunk-NUBUQFLH.js";

// src/internal/secrets.ts
var PRIVATE_KEY_BLOCK = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY(?: BLOCK)?-----|$)/g;
var SHAPED = Object.freeze([
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
  ["token", /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g]
]);
var BEARER = /\bBearer\s+([A-Za-z0-9._~+/=-]+)/gi;
var AUTH_HEADER = /\b(?:authorization|x-api-key)\b["']?\s*[:=]\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s,;]+(?:[ \t]+[^\s,;]+)?))/gi;
var CONNECTION = /\b[a-z][a-z0-9+.-]*:\/\/([^\s:@/]+):([^\s/]*)@[^\s@/]+/gi;
var CREDENTIAL_KEYS = "api[_-]?key|apikey|access[_-]?key|access[_-]?token|refresh[_-]?token|auth[_-]?token|client[_-]?secret|secret[_-]?key|private[_-]?key|passphrase|password|passwd|pwd|token|secret";
var ASSIGNMENT = new RegExp(
  String.raw`(?<![A-Za-z0-9])([A-Za-z0-9_.-]*?(${CREDENTIAL_KEYS}))["']?((?:[ \t]+(?:is|was))?[ \t]*[:=][ \t]*(?:\r?\n[ \t]*)?)(?:"([^"\n]*)"|'([^'\n]*)'|` + "`([^`\\n]*)`" + String.raw`|([^\s,;&]+))`,
  "gi"
);
var PLACEHOLDER = /^(?:\[[^\]]*\]|<[^>]*>|\{\{.*\}\}|\$\{?[A-Za-z_][\w.]*\}?|%[A-Za-z_]\w*%|\*+|x{3,}|\.{2,}|…|-+|true|false|null|nil|none|undefined|string|str|number|int|bool|required|optional|env|secret|password|token|redacted|placeholder|changeme|example|your[_-]?\w*|(?:process\.env|os\.environ|env)\b.*)$/i;
var JWT_IO_SAMPLE = /eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ|SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c/;
var TOKENISH = /^[A-Za-z0-9._~+/=!@#$%^&*()\-:]+$/;
function documentation(value) {
  const v = String(value ?? "").trim();
  return PLACEHOLDER.test(v) || /example/i.test(v) || /x{4,}/i.test(v) || /<[^>]*>/.test(v) || /\byour[-_][\w-]*here\b/i.test(v) || /\$\{|\{\{/.test(v) || JWT_IO_SAMPLE.test(v) || /[…]|\.{3}$/.test(v);
}
function codeValue(value) {
  const v = String(value ?? "").trim();
  return (
    // `session.accessToken`, `config.secretKey`: identifiers, not a random token with digits in it.
    /^[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)+;?$/.test(v) && (v.match(/\d/g) ?? []).length <= 2 || /^(?:await\s+)?[A-Za-z_$][\w$.]*\(/.test(v) || /^(?:~|\.{1,2})?\/[\w./-]*$/.test(v) || /^(?:process\.env|os\.environ|import\.meta\.env)\b/.test(v)
  );
}
function entropy(value) {
  const counts = /* @__PURE__ */ new Map();
  for (const char of value) counts.set(char, (counts.get(char) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}
function tokenShaped(value, min = 12) {
  const v = String(value ?? "").trim();
  return v.length >= min && TOKENISH.test(v) && /\d/.test(v) && /[A-Za-z]/.test(v) && entropy(v) >= 3 && !documentation(v) && !codeValue(v);
}
var PROSE_WORDS = new Set(
  "a an the is are was were be been must should shall will can may not no never always every each at least most of to in on for and or with by from via see use uses used set stored managed rotated rotate required policy characters chars minimum maximum change changed expires expire reset same as one this that it its".split(" ")
);
function passphrase(rest) {
  const line2 = String(rest ?? "").trim();
  if (line2.length < 16 || /[.!?]$/.test(line2)) return false;
  const words = line2.split(/\s+/);
  return words.length >= 3 && words.length <= 8 && words.every((word) => /^[A-Za-z][A-Za-z'-]*$/.test(word) && !PROSE_WORDS.has(word.toLowerCase()));
}
function credentialValue(value, quoted, key, query) {
  const v = String(value ?? "").trim();
  if (!v || documentation(v)) return false;
  if (query) return tokenShaped(v, 16);
  const loose = /^(?:token|secret)$/i.test(key);
  if (quoted) return v.length >= (loose ? 8 : 4) && !/^\d+(?:\.\d+)?$/.test(v) && !/^[A-Za-z_$][\w$.]*\(|^\$\{/.test(v);
  if (codeValue(v) || !TOKENISH.test(v) || /^\d+(?:\.\d+)?$/.test(v)) return false;
  if (v.length < (loose ? 8 : 6)) return false;
  return /\d/.test(v) || /[^A-Za-z0-9]/.test(v) || /.[A-Z]/.test(v);
}
function secretKinds(text2) {
  const value = String(text2 ?? "");
  const kinds = /* @__PURE__ */ new Set();
  if (new RegExp(PRIVATE_KEY_BLOCK.source).test(value)) kinds.add("private key");
  for (const [kind, pattern, valid] of SHAPED) {
    for (const match of value.matchAll(pattern)) if (!documentation(match[0]) && (!valid || valid(match[0]))) kinds.add(kind);
  }
  for (const match of value.matchAll(BEARER)) if (tokenShaped(match[1])) kinds.add("token");
  for (const match of value.matchAll(AUTH_HEADER)) {
    const v = String(match[1] ?? match[2] ?? match[3] ?? "").trim().replace(/^(?:Bearer|Basic|Token|Bot)\s+/i, "");
    if (tokenShaped(v)) kinds.add("token");
  }
  for (const match of value.matchAll(CONNECTION)) if (match[2].length >= 3 && !documentation(match[2])) kinds.add("connection string");
  for (const match of value.matchAll(ASSIGNMENT)) {
    const key = match[2];
    const quoted = match[4] ?? match[5] ?? match[6];
    const bare = match[7];
    const crossed = /\n/.test(match[3]);
    if (crossed && bare !== void 0 && /^[A-Za-z_][\w.-]*[:=]/.test(bare)) continue;
    const query = /[?&]/.test(value[match.index - 1] ?? "");
    const password = /pass|pwd/i.test(key);
    let found = credentialValue(quoted ?? bare, quoted !== void 0, key, query);
    if (!found && password && quoted === void 0 && !query) {
      const start = match.index + match[0].length - (bare ?? "").length;
      const end = value.indexOf("\n", start);
      found = passphrase(value.slice(start, end === -1 ? value.length : end));
    }
    if (found) kinds.add(password ? "password" : /token/i.test(key) ? "token" : "api key");
  }
  return [...kinds];
}

// src/internal/events.ts
import { createHash } from "node:crypto";
var EVENTS_LIST = "events_list";
var EVENT_KINDS = ["message", "meeting", "session", "bookmark", "issue", "pr", "commit", "doc", "event", "task", "file"];
var EXTENSION_SEGMENT_MAX = 32;
var EXTENSION_NAME = new RegExp(`^x-[a-z][a-z0-9-]{0,${EXTENSION_SEGMENT_MAX - 1}}/[a-z][a-z0-9-]{0,${EXTENSION_SEGMENT_MAX - 1}}$`);
var EXTENSION_KIND = EXTENSION_NAME;
var isExtensionName = (name) => typeof name === "string" && EXTENSION_NAME.test(name);
var isEventKind = (kind) => typeof kind === "string" && (EVENT_KINDS.includes(kind) || isExtensionName(kind));
function extensionNamespace(kind) {
  return isEventKind(kind) && kind.startsWith("x-") ? kind.slice(2, kind.indexOf("/")) : void 0;
}
function isEventKindIn(kind, namespace) {
  if (!isEventKind(kind)) return false;
  const own = extensionNamespace(kind);
  return own === void 0 || own === namespace;
}
var sourceNamespace = (sourceId) => sourceId.split(".", 1)[0] ?? sourceId;
var EVENT_LIMITS = {
  source: 64,
  account: 128,
  externalId: 512,
  thread: 512,
  title: 300,
  text: 4096,
  url: 2048,
  actors: 20,
  actorRole: 32,
  actorId: 320,
  actorName: 200,
  labels: 20,
  label: 64,
  ownerId: 320,
  ownerLabel: 200,
  cursor: MAX_CURSOR_LENGTH,
  scopeKeys: 16,
  scopeKey: 64,
  scopeValues: 64,
  scopeValue: 256,
  refused: 500,
  failed: 500,
  detail: 200,
  costUnits: 8,
  /** #45 §1: the identities one actor may carry, and the lengths of each part of one. */
  identities: 10,
  identityBasis: 64,
  /** #45 §2: the metadata one event may carry. */
  replyTo: 512,
  domains: 20,
  domain: 253,
  sections: 20,
  sectionHeading: 300,
  parts: 50,
  partId: 512,
  /** #45 §3: the facts one event may carry, and the lengths of their fields. */
  facts: 20,
  factKey: 200,
  factTitle: 300,
  factAttribute: 120
};
var PAGE = { default: 100, min: 1, max: 500 };
var MAX_PAGE_BYTES = 65536;
var MAX_BYTES = { default: 65536, max: 1048576 };
var FIRST_RUN_HOURS = 24;
var TRUST = "untrusted";
var ACTOR_KINDS = ["person", "agent", "bot", "service"];
var ACTOR_ROLES = ["from", "author", "to", "cc", "bcc", "mentioned", "assignee", "creator", "reviewer", "organizer", "attendee", "owner", "speaker", "agent"];
var AUTHOR_ROLES = ["from", "author"];
var IDENTITY_STRENGTHS = ["strong", "weak"];
var AUDIENCES = ["dm", "group", "channel", "email", "public"];
var FACT_TYPES = ["commitment", "person.attribute", "meeting.attended"];
var COMMITMENT_STATES = ["open", "done", "cancelled"];
var ATTENDANCE_RESPONSES = ["accepted", "declined", "tentative", "needs_action"];
function ownerShapeProblems(owner, what) {
  if (!plainObject(owner) || !line(owner["id"], EVENT_LIMITS.ownerId) || !line(owner["label"], EVENT_LIMITS.ownerLabel) || Object.keys(owner).some((key) => key !== "id" && key !== "label" && key !== "verified")) {
    return [`${what} must be { id, label }, two non-empty lines`];
  }
  if (owner["verified"] !== void 0 && owner["verified"] !== false) return [`${what}.verified must be false, or left out for an owner the provider named`];
  return [];
}
var REFUSAL_REASONS = ["instruction", "secret", "owner"];
var REMOVAL_REASONS = ["deleted", "withheld", "expired"];
var GAP_REASONS = ["expired", "window-truncated"];
var ERROR_CODES = [
  "NEEDS_SIGN_IN",
  "ACCOUNT_MISMATCH",
  "CURSOR_INVALID",
  "CURSOR_EXPIRED",
  "RATE_LIMITED",
  "TOO_LARGE",
  "SCHEMA_VIOLATION",
  "PERMISSION_DENIED",
  "UNAVAILABLE",
  "SCOPE_MISSING",
  "BUDGET_EXCEEDED",
  "SOURCE_DISABLED",
  "INPUT_INVALID",
  "SOURCE_UNKNOWN"
];
var PROPOSED_CODES = [];
var ERROR_ALIASES = { AUTH_REQUIRED: "NEEDS_SIGN_IN", ACCOUNT_UNKNOWN: "ACCOUNT_MISMATCH" };
var CONTRACT1_CODES = {
  EVENTS_INVALID_INPUT: "INPUT_INVALID",
  EVENTS_CURSOR_INVALID: "CURSOR_INVALID",
  EVENTS_SOURCE_UNKNOWN: "SOURCE_UNKNOWN"
};
function canonicalCode(code) {
  if (ERROR_CODES.includes(code) || PROPOSED_CODES.includes(code)) return code;
  return ERROR_ALIASES[code] ?? CONTRACT1_CODES[code];
}
var SourceError = class extends Error {
  code;
  what;
  next;
  retryAfterSec;
  gap;
  constructor(init) {
    super(`${init.code}: ${init.what.replace(/[.\s]+$/, "")}. Next step: ${init.next}`);
    this.name = "SourceError";
    this.code = init.code;
    this.what = init.what;
    this.next = init.next;
    if (init.retryAfterSec !== void 0) this.retryAfterSec = init.retryAfterSec;
    if (init.gap !== void 0) this.gap = init.gap;
  }
};
var FAMILY_MESSAGE = /^([A-Z][A-Z0-9_]*): ([^]*?)(?:\. Next step: ([^]*))?$/;
function parseSourceError(error) {
  if (error instanceof SourceError) {
    const canonical2 = canonicalCode(error.code);
    return { code: error.code, ...canonical2 ? { canonical: canonical2 } : {}, what: error.what, next: error.next };
  }
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : void 0;
  const match = message === void 0 ? null : FAMILY_MESSAGE.exec(message.split("\n", 1)[0] ?? "");
  if (!match) return void 0;
  const canonical = canonicalCode(match[1]);
  return { code: match[1], ...canonical ? { canonical } : {}, what: match[2], ...match[3] === void 0 ? {} : { next: match[3] } };
}
var SINCE_PATTERN = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2}))?$/;
var SOURCE_PATTERN = /^[a-z][a-z0-9-]*$/;
var SCOPE_KEY_PATTERN = /^[a-z][A-Za-z0-9_-]*$/;
var INPUT_KEYS = ["since", "cursor", "limit", "account", "source"];
var hasControl = (text2) => [...text2].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
var plainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function sinceTime(since) {
  if (!SINCE_PATTERN.test(since)) return void 0;
  const time = Date.parse(since.length === 10 ? `${since}T00:00:00Z` : since);
  return Number.isFinite(time) ? time : void 0;
}
var scopeValue = (value) => typeof value === "string" && value.length > 0 && value.length <= EVENT_LIMITS.scopeValue && !hasControl(value);
function scopeProblems(scope, keys) {
  if (!plainObject(scope)) return [`"scope" must be an object of the source's scope keys`];
  const problems = [];
  const entries = Object.entries(scope);
  if (entries.length > EVENT_LIMITS.scopeKeys) problems.push(`"scope" has more than ${EVENT_LIMITS.scopeKeys} keys`);
  for (const [key, value] of entries) {
    if (!keys.includes(key)) {
      problems.push(SCOPE_KEY_PATTERN.test(key) && key.length <= EVENT_LIMITS.scopeKey ? `"scope.${key}" is not a scope key of this source` : `"scope" has a key that is not a scope key of this source`);
      continue;
    }
    const ok = scopeValue(value) || Array.isArray(value) && value.length <= EVENT_LIMITS.scopeValues && value.every(scopeValue);
    if (!ok) problems.push(`"scope.${key}" must be a value, or a list of at most ${EVENT_LIMITS.scopeValues} values, of at most ${EVENT_LIMITS.scopeValue} characters`);
  }
  return problems;
}
function parseEventsListInput(input, options = {}) {
  const value = input === void 0 || input === null ? {} : input;
  if (!plainObject(value)) return { ok: false, problems: ["the input must be an object"] };
  const scoped = (options.scopeKeys?.length ?? 0) > 0;
  const known = scoped ? [...INPUT_KEYS, "scope"] : INPUT_KEYS;
  const problems = Object.keys(value).filter((key) => !known.includes(key)).map((key) => `"${key}" is not an input of events_list`);
  const { since, cursor, limit, account, source, scope } = value;
  let time;
  if (since !== void 0) {
    time = typeof since === "string" ? sinceTime(since) : void 0;
    if (time === void 0) problems.push(`"since" must be an ISO date, or an ISO date-time with Z or an offset`);
  }
  if (cursor !== void 0 && (typeof cursor !== "string" || cursor.length === 0 || cursor.length > EVENT_LIMITS.cursor)) {
    problems.push(`"cursor" must be a cursor from a previous result`);
  }
  if (limit !== void 0 && (typeof limit !== "number" || !Number.isInteger(limit) || limit < PAGE.min || limit > PAGE.max)) {
    problems.push(`"limit" must be an integer from ${PAGE.min} to ${PAGE.max}`);
  }
  if (account !== void 0 && (typeof account !== "string" || account.length === 0 || account.length > EVENT_LIMITS.account || hasControl(account))) {
    problems.push(`"account" must be a non-empty account name of at most ${EVENT_LIMITS.account} characters`);
  }
  if (source !== void 0 && (typeof source !== "string" || source.length > EVENT_LIMITS.source || !SOURCE_PATTERN.test(source))) {
    problems.push(`"source" must be a source's name, a lowercase word such as gmail`);
  }
  if (scoped && scope !== void 0) problems.push(...scopeProblems(scope, options.scopeKeys));
  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    value: {
      ...time === void 0 ? {} : { since: time },
      ...cursor === void 0 ? {} : { cursor },
      limit: limit ?? PAGE.default,
      ...account === void 0 ? {} : { account },
      ...source === void 0 ? {} : { source },
      ...scoped && scope !== void 0 ? { scope: canonicalScope(scope) } : {}
    }
  };
}
function startTime(request, now) {
  return request.since ?? now - FIRST_RUN_HOURS * 36e5;
}
function cut(text2, max) {
  if (text2.length <= max) return text2;
  let end = Math.max(0, max - 1);
  const code = text2.charCodeAt(end - 1);
  if (end > 0 && code >= 55296 && code <= 56319) end--;
  return `${text2.slice(0, end)}\u2026`;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value === "object" && value !== null) {
    const entries = Object.keys(value).filter((key) => value[key] !== void 0);
    return Object.fromEntries(entries.sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
var HASHED_EVENT_FIELDS = ["reply_to", "audience", "domains", "sections", "parts", "facts"];
function actorFields(actor) {
  const base = [actor.role, actor.id, actor.name ?? null];
  const extra = stable({ kind: actor.kind, identities: actor.identities, self: actor.self });
  return Object.keys(extra).length === 0 ? base : [...base, extra];
}
function eventHash(event) {
  const fields = [
    event.source,
    event.account,
    event.external_id,
    event.kind,
    event.occurred_at,
    event.thread,
    event.actors.map(actorFields),
    event.title,
    event.text,
    event.url,
    event.labels
  ];
  for (const key of HASHED_EVENT_FIELDS) {
    const value = event[key];
    if (value !== void 0) fields.push([key, stable(value)]);
  }
  return `sha256:${createHash("sha256").update(JSON.stringify(fields)).digest("hex")}`;
}
var clean = (text2) => text2.replaceAll("\0", "");
var oneLine = (text2) => clean(text2).replace(/\s+/g, " ").trim();
function makeEvent(draft) {
  const time = draft.occurred_at instanceof Date ? draft.occurred_at.getTime() : typeof draft.occurred_at === "number" ? draft.occurred_at : Date.parse(draft.occurred_at);
  if (!Number.isFinite(time)) throw new Error("events-list: an event's occurred_at is not a time");
  const seen = /* @__PURE__ */ new Set();
  const actors = [];
  for (const actor of draft.actors ?? []) {
    const role = oneLine(actor.role).toLowerCase();
    const id = oneLine(actor.id);
    const key = `${role}\0${id}`;
    if (!role || !id || seen.has(key) || actors.length >= EVENT_LIMITS.actors) continue;
    seen.add(key);
    const name = actor.name ? cut(oneLine(actor.name), EVENT_LIMITS.actorName) : "";
    actors.push({
      role,
      id,
      ...name ? { name } : {},
      ...actor.kind === void 0 ? {} : { kind: actor.kind },
      // An empty list says nothing, and is left out so the actor hashes as if it had none.
      ...actor.identities === void 0 || actor.identities.length === 0 ? {} : { identities: [...actor.identities] },
      ...actor.self === void 0 ? {} : { self: actor.self }
    });
  }
  const labels = [...new Set((draft.labels ?? []).map((label) => oneLine(label).replace(/\s/g, "-")).filter((label) => label.length > 0 && label.length <= EVENT_LIMITS.label))].slice(0, EVENT_LIMITS.labels);
  const url = draft.url && /^https:\/\/\S+$/.test(draft.url) && draft.url.length <= EVENT_LIMITS.url ? draft.url : null;
  const thread = draft.thread ? oneLine(draft.thread) || null : null;
  const replyTo = draft.reply_to ? cut(oneLine(draft.reply_to), EVENT_LIMITS.replyTo) : void 0;
  const domains = draft.domains === void 0 ? void 0 : [...new Set(draft.domains.map((domain) => oneLine(domain).toLowerCase()))].filter((domain) => domain.length > 0);
  const sections = draft.sections?.map((section) => ({ heading: cut(oneLine(section.heading), EVENT_LIMITS.sectionHeading), text: cut(clean(section.text), EVENT_LIMITS.text) })).filter((section) => section.heading.length > 0);
  const parts = draft.parts?.map((part) => {
    const id = cut(oneLine(part.id), EVENT_LIMITS.partId);
    const actor = part.actor === void 0 ? "" : oneLine(part.actor);
    return { id, text: cut(clean(part.text), EVENT_LIMITS.text), ...actor ? { actor } : {} };
  }).filter((part) => part.id.length > 0);
  const event = {
    source: draft.source,
    account: draft.account,
    external_id: draft.external_id,
    kind: draft.kind,
    occurred_at: new Date(time).toISOString(),
    thread,
    actors,
    title: cut(oneLine(draft.title ?? ""), EVENT_LIMITS.title),
    text: cut(clean(draft.text ?? "").trim(), EVENT_LIMITS.text),
    url,
    labels,
    ...replyTo === void 0 ? {} : { reply_to: replyTo },
    ...draft.audience === void 0 || draft.audience === null ? {} : { audience: draft.audience },
    ...domains === void 0 || domains.length === 0 ? {} : { domains },
    ...sections === void 0 || sections.length === 0 ? {} : { sections },
    ...parts === void 0 || parts.length === 0 ? {} : { parts },
    ...draft.facts === void 0 || draft.facts.length === 0 ? {} : { facts: [...draft.facts] }
  };
  return { ...event, hash: eventHash(event) };
}
function oldestFirst(events) {
  return events.map((event, index) => ({ event, index, time: Date.parse(event.occurred_at) })).sort((a, b) => a.time - b.time || a.index - b.index).map(({ event }) => event);
}
function fitPage(events, limit, maxBytes = MAX_PAGE_BYTES) {
  let bytes = 2048;
  let count = 0;
  for (const event of events) {
    if (count >= limit) break;
    bytes += Buffer.byteLength(JSON.stringify(event)) + 1;
    if (count > 0 && bytes > maxBytes) break;
    count++;
  }
  return count;
}
function screenEvents(events, options = {}) {
  const detect = options.secrets ?? secretKinds;
  const kept = [];
  const refused = [];
  for (const event of events) {
    if (options.ownedBy && !options.ownedBy(event)) {
      refused.push({ external_id: event.external_id, reason: "owner" });
      continue;
    }
    const kinds = detect([event.title, event.text].filter(Boolean).join("\n"));
    if (kinds.length > 0) {
      refused.push({ external_id: event.external_id, reason: "secret", detail: cut(`holds a secret (${kinds.join(", ")})`, EVENT_LIMITS.detail) });
      continue;
    }
    if (options.instruction?.(event)) {
      refused.push({ external_id: event.external_id, reason: "instruction" });
      continue;
    }
    kept.push(event);
  }
  return { events: kept, refused };
}
var PROBE = "probe";
var PROBE_LIMITS = { scopes: 64, scope: 256 };
function parseProbeInput(input) {
  const value = input === void 0 || input === null ? {} : input;
  if (!plainObject(value)) return { ok: false, problems: ["the input must be an object"] };
  const problems = Object.keys(value).filter((key) => key !== "source" && key !== "account").map((key) => `"${key}" is not an input of probe`);
  const { source, account } = value;
  if (source !== void 0 && (typeof source !== "string" || source.length > EVENT_LIMITS.source || !SOURCE_PATTERN.test(source))) {
    problems.push(`"source" must be a source's name, a lowercase word such as gmail`);
  }
  if (account !== void 0 && (typeof account !== "string" || account.length === 0 || account.length > EVENT_LIMITS.account || hasControl(account))) {
    problems.push(`"account" must be a non-empty account name of at most ${EVENT_LIMITS.account} characters`);
  }
  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, value: { ...source === void 0 ? {} : { source }, ...account === void 0 ? {} : { account } } };
}
function probeResult(identity, extras = {}) {
  return {
    source: identity.source,
    account: identity.account,
    owner: { id: identity.owner.id, label: identity.owner.label, ...identity.owner.verified === void 0 ? {} : { verified: identity.owner.verified } },
    ...extras.scopes === void 0 ? {} : { scopes: [...new Set(extras.scopes)] },
    ...extras.cost === void 0 ? {} : { cost: extras.cost },
    trust: TRUST
  };
}
var PROBE_KEYS = ["source", "account", "owner", "scopes", "cost", "trust"];
function probeResultProblems(result, expected = {}) {
  if (!plainObject(result)) return ["the probe answer is not an object"];
  const problems = [];
  for (const key of Object.keys(result)) if (!PROBE_KEYS.includes(key)) problems.push(`the probe answer has the field "${key}": a probe reads no content, and the contract defines no such field`);
  if (!line(result["source"], EVENT_LIMITS.source) || !SOURCE_PATTERN.test(result["source"])) problems.push("the probe answer's source must be a lowercase name such as gmail");
  else if (expected.source !== void 0 && result["source"] !== expected.source) problems.push(`the probe answer names the source ${result["source"]}, not ${expected.source}`);
  if (!line(result["account"], EVENT_LIMITS.account)) problems.push(`the probe answer's account must be a non-empty name of at most ${EVENT_LIMITS.account} characters`);
  else if (expected.account !== void 0 && result["account"] !== expected.account) problems.push("the probe answer names another account than the one asked for");
  const owner = result["owner"];
  const ownerShape = ownerShapeProblems(owner, "the probe answer's owner");
  if (ownerShape.length > 0) {
    problems.push(...ownerShape);
  } else if (!SCHEMED.test(owner["id"])) {
    problems.push("the probe answer's owner.id must be a scheme-qualified id such as mailto:someone@example.com or slack:U0123");
  }
  const scopes = result["scopes"];
  if (scopes !== void 0 && (!Array.isArray(scopes) || scopes.length > PROBE_LIMITS.scopes || scopes.some((scope) => !line(scope, PROBE_LIMITS.scope)) || new Set(scopes).size !== scopes.length)) {
    problems.push(`the probe answer's scopes must be at most ${PROBE_LIMITS.scopes} different lines of at most ${PROBE_LIMITS.scope} characters`);
  }
  if (result["cost"] !== void 0) problems.push(...extraProblems({ cost: result["cost"] }, /* @__PURE__ */ new Set()).map((problem) => problem.replace("the result's cost", "the probe answer's cost")));
  if (result["trust"] !== TRUST) problems.push(`the probe answer's trust must be "${TRUST}"`);
  return problems;
}
function eventsListResult(identity, events, cursor, more, extras = {}) {
  return {
    source: identity.source,
    account: identity.account,
    owner: identity.owner,
    events: [...events],
    cursor,
    more,
    trust: TRUST,
    ...extras.scope === void 0 ? {} : { scope: canonicalScope(extras.scope) },
    ...extras.refused && extras.refused.length > 0 ? { refused: [...extras.refused] } : {},
    ...extras.failed && extras.failed.length > 0 ? { failed: [...extras.failed] } : {},
    ...extras.removals && extras.removals.length > 0 ? { removals: [...extras.removals] } : {},
    ...extras.gap === void 0 ? {} : { gap: extras.gap },
    ...extras.cost === void 0 ? {} : { cost: extras.cost },
    ...extras.plugin === void 0 ? {} : { plugin: extras.plugin },
    ...extras.asOf === void 0 ? {} : { asOf: extras.asOf }
  };
}
var ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
var ROLE = /^[a-z][a-z0-9_-]*$/;
var SCHEMED = /^[a-z][a-z0-9+.-]*:\S+$/;
var HASH = /^sha256:[0-9a-f]{64}$/;
var CODE = /^[A-Z][A-Z0-9_]*$/;
var UNIT = /^[a-z][a-z0-9_-]*$/;
var DOMAIN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
var DATE = /^\d{4}-\d{2}-\d{2}$/;
var listOf = (items) => items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} or ${items.at(-1)}`;
var text = (value, max, empty = false) => typeof value === "string" && value.length <= max && (empty || value.length > 0) && !value.includes("\0");
var line = (value, max, empty = false) => text(value, max, empty) && !hasControl(value);
var isoUtc = (value) => typeof value === "string" && ISO_UTC.test(value) && Number.isFinite(Date.parse(value));
function actorProblems(actor, at) {
  const problems = [];
  for (const key of Object.keys(actor)) if (!["role", "id", "name", "kind", "identities", "self"].includes(key)) problems.push(`${at} has the field "${key}", which the contract does not define`);
  const role = actor.role;
  const id = actor.id;
  if (!line(role, EVENT_LIMITS.actorRole) || !ROLE.test(role)) problems.push(`${at}.role must be a lowercase word such as from`);
  if (!line(id, EVENT_LIMITS.actorId) || !SCHEMED.test(id)) problems.push(`${at}.id must be a scheme-qualified id such as mailto:someone@example.com`);
  if (actor.name !== void 0 && !line(actor.name, EVENT_LIMITS.actorName)) problems.push(`${at}.name must be one non-empty line of at most ${EVENT_LIMITS.actorName} characters`);
  if (actor.kind !== void 0 && !ACTOR_KINDS.includes(actor.kind)) problems.push(`${at}.kind must be ${listOf(ACTOR_KINDS)}`);
  if (actor.self !== void 0 && typeof actor.self !== "boolean") problems.push(`${at}.self must be true or false`);
  if (actor.identities !== void 0) {
    if (!Array.isArray(actor.identities) || actor.identities.length > EVENT_LIMITS.identities) problems.push(`${at}.identities must be a list of at most ${EVENT_LIMITS.identities}`);
    else {
      const seen = /* @__PURE__ */ new Set();
      for (const [index, identity] of actor.identities.entries()) {
        const here = `${at}.identities[${index}]`;
        if (!plainObject(identity)) {
          problems.push(`${here} is not an object`);
          continue;
        }
        for (const key of Object.keys(identity)) if (!["id", "strength", "basis"].includes(key)) problems.push(`${here} has the field "${key}", which the contract does not define`);
        const own = identity.id;
        if (!line(own, EVENT_LIMITS.actorId) || !SCHEMED.test(own)) problems.push(`${here}.id must be a scheme-qualified id such as mailto:someone@example.com`);
        else if (own === id) problems.push(`${here}.id is the actor's own id: an identity is another id for the same actor`);
        else if (seen.has(own)) problems.push(`${here} repeats an identity`);
        else seen.add(own);
        if (!IDENTITY_STRENGTHS.includes(identity.strength)) problems.push(`${here}.strength must be ${listOf(IDENTITY_STRENGTHS)}`);
        if (!line(identity.basis, EVENT_LIMITS.identityBasis)) {
          problems.push(`${here}.basis must be one line of at most ${EVENT_LIMITS.identityBasis} characters naming the provider field it came from`);
        }
      }
    }
  }
  return problems;
}
function targetProblems(e, where) {
  const problems = [];
  if (e.reply_to !== void 0 && !line(e.reply_to, EVENT_LIMITS.replyTo)) {
    problems.push(`${where}.reply_to must be a non-empty id of at most ${EVENT_LIMITS.replyTo} characters`);
  }
  if (e.audience !== void 0 && !AUDIENCES.includes(e.audience)) {
    problems.push(`${where}.audience must be ${listOf(AUDIENCES)}`);
  }
  if (e.domains !== void 0) {
    if (!Array.isArray(e.domains) || e.domains.length > EVENT_LIMITS.domains) problems.push(`${where}.domains must be at most ${EVENT_LIMITS.domains} lowercase domains`);
    else {
      const seen = /* @__PURE__ */ new Set();
      for (const [index, domain] of e.domains.entries()) {
        if (!line(domain, EVENT_LIMITS.domain) || !DOMAIN.test(domain)) problems.push(`${where}.domains[${index}] must be a lowercase domain such as example.com`);
        else if (seen.has(domain)) problems.push(`${where}.domains repeats a domain`);
        else seen.add(domain);
      }
    }
  }
  return problems;
}
function partProblems(e, where, actorIds) {
  const problems = [];
  if (e.sections !== void 0) {
    if (!Array.isArray(e.sections) || e.sections.length > EVENT_LIMITS.sections) problems.push(`${where}.sections must be a list of at most ${EVENT_LIMITS.sections}`);
    else {
      for (const [index, section] of e.sections.entries()) {
        const at = `${where}.sections[${index}]`;
        if (!plainObject(section)) {
          problems.push(`${at} is not an object`);
          continue;
        }
        for (const key of Object.keys(section)) if (!["heading", "text"].includes(key)) problems.push(`${at} has the field "${key}", which the contract does not define`);
        if (!line(section.heading, EVENT_LIMITS.sectionHeading)) problems.push(`${at}.heading must be one line of at most ${EVENT_LIMITS.sectionHeading} characters`);
        if (!text(section.text, EVENT_LIMITS.text, true)) problems.push(`${at}.text must be at most ${EVENT_LIMITS.text} characters`);
      }
    }
  }
  if (e.parts !== void 0) {
    if (!Array.isArray(e.parts) || e.parts.length > EVENT_LIMITS.parts) problems.push(`${where}.parts must be a list of at most ${EVENT_LIMITS.parts}`);
    else {
      const seen = /* @__PURE__ */ new Set();
      for (const [index, part] of e.parts.entries()) {
        const at = `${where}.parts[${index}]`;
        if (!plainObject(part)) {
          problems.push(`${at} is not an object`);
          continue;
        }
        for (const key of Object.keys(part)) if (!["id", "text", "actor"].includes(key)) problems.push(`${at} has the field "${key}", which the contract does not define`);
        const id = part.id;
        if (!line(id, EVENT_LIMITS.partId)) problems.push(`${at}.id must be a non-empty id of at most ${EVENT_LIMITS.partId} characters`);
        else if (seen.has(id)) problems.push(`${at}.id repeats a part`);
        else seen.add(id);
        if (!text(part.text, EVENT_LIMITS.text, true)) problems.push(`${at}.text must be at most ${EVENT_LIMITS.text} characters`);
        if (part.actor !== void 0) {
          if (!line(part.actor, EVENT_LIMITS.actorId)) problems.push(`${at}.actor must be an actor id of the same event`);
          else if (!actorIds.has(part.actor)) problems.push(`${at}.actor is not an actor of the same event`);
        }
      }
    }
  }
  return problems;
}
function factProblems(fact, actors, where = "fact") {
  if (!plainObject(fact)) return [`${where} is not an object`];
  const type = fact.type;
  if (!FACT_TYPES.includes(type)) return [`${where}.type must be ${listOf(FACT_TYPES)}`];
  const allowed = {
    commitment: ["type", "key", "title", "owner", "counterparty", "due", "state", "url"],
    "person.attribute": ["type", "actor", "org", "team", "role"],
    "meeting.attended": ["type", "actor", "response", "organizer"]
  };
  const problems = [];
  for (const key of Object.keys(fact)) {
    if (!allowed[type].includes(key)) problems.push(`${where} has the field "${key}", which the contract does not define`);
  }
  const reference = (key) => {
    const id = fact[key];
    if (!line(id, EVENT_LIMITS.actorId)) problems.push(`${where}.${key} must be an actor id of the same event`);
    else if (!actors.has(id)) problems.push(`${where}.${key} is not an actor of the same event`);
  };
  if (type === "commitment") {
    if (!line(fact.key, EVENT_LIMITS.factKey)) problems.push(`${where}.key must be a stable id of at most ${EVENT_LIMITS.factKey} characters`);
    if (!line(fact.title, EVENT_LIMITS.factTitle)) problems.push(`${where}.title must be one line of at most ${EVENT_LIMITS.factTitle} characters`);
    reference("owner");
    if (fact.counterparty !== void 0) reference("counterparty");
    if (fact.due !== void 0 && !(typeof fact.due === "string" && DATE.test(fact.due) && Number.isFinite(Date.parse(fact.due)))) problems.push(`${where}.due must be a date such as 2026-11-30`);
    if (!COMMITMENT_STATES.includes(fact.state)) problems.push(`${where}.state must be ${listOf(COMMITMENT_STATES)}`);
    if (fact.url !== void 0 && !(typeof fact.url === "string" && fact.url.length <= EVENT_LIMITS.url && /^https:\/\/\S+$/.test(fact.url))) problems.push(`${where}.url must be an https URL`);
  }
  if (type === "person.attribute") {
    reference("actor");
    if (fact.org === void 0 && fact.team === void 0 && fact.role === void 0) {
      problems.push(`${where} must name org, team or role: a person's attribute comes from structured profile or directory data`);
    }
    for (const key of ["org", "team", "role"]) {
      if (fact[key] !== void 0 && !line(fact[key], EVENT_LIMITS.factAttribute)) {
        problems.push(`${where}.${key} must be one line of at most ${EVENT_LIMITS.factAttribute} characters`);
      }
    }
  }
  if (type === "meeting.attended") {
    reference("actor");
    if (!ATTENDANCE_RESPONSES.includes(fact.response)) problems.push(`${where}.response must be ${listOf(ATTENDANCE_RESPONSES)}`);
    if (typeof fact.organizer !== "boolean") problems.push(`${where}.organizer must be true or false`);
  }
  return problems;
}
function factsProblems(e, where, actorIds) {
  if (e.facts === void 0) return [];
  if (!Array.isArray(e.facts) || e.facts.length > EVENT_LIMITS.facts) return [`${where}.facts must be a list of at most ${EVENT_LIMITS.facts}`];
  return e.facts.flatMap((fact, index) => factProblems(fact, actorIds, `${where}.facts[${index}]`));
}
var EVENT_KEYS = ["source", "account", "external_id", "kind", "occurred_at", "thread", "actors", "title", "text", "url", "labels", "hash"];
var EVENT_METADATA_KEYS = ["reply_to", "audience", "domains", "sections", "parts", "facts"];
function eventProblems(event, where = "event") {
  if (!plainObject(event)) return [`${where} is not an object`];
  const problems = [];
  const keys = [...EVENT_KEYS, ...EVENT_METADATA_KEYS];
  for (const key of Object.keys(event)) if (!keys.includes(key)) problems.push(`${where} has the field "${key}", which the contract does not define`);
  for (const key of EVENT_KEYS) if (!Object.hasOwn(event, key)) problems.push(`${where} has no "${key}"`);
  const e = event;
  if (!line(e.source, EVENT_LIMITS.source) || !SOURCE_PATTERN.test(e.source)) problems.push(`${where}.source must be a lowercase name such as gmail`);
  if (!line(e.account, EVENT_LIMITS.account)) problems.push(`${where}.account must be a non-empty name of at most ${EVENT_LIMITS.account} characters`);
  if (!line(e.external_id, EVENT_LIMITS.externalId)) problems.push(`${where}.external_id must be a non-empty id of at most ${EVENT_LIMITS.externalId} characters`);
  if (!isEventKind(e.kind)) problems.push(`${where}.kind must be one of ${EVENT_KINDS.join(", ")}, or x-<plugin>/<kind>`);
  if (!isoUtc(e.occurred_at)) problems.push(`${where}.occurred_at must be a UTC ISO date-time ending in Z`);
  if (e.thread !== null && !line(e.thread, EVENT_LIMITS.thread)) problems.push(`${where}.thread must be null or a non-empty id of at most ${EVENT_LIMITS.thread} characters`);
  if (!line(e.title, EVENT_LIMITS.title, true)) problems.push(`${where}.title must be one line of at most ${EVENT_LIMITS.title} characters`);
  if (!text(e.text, EVENT_LIMITS.text, true)) problems.push(`${where}.text must be at most ${EVENT_LIMITS.text} characters`);
  if (e.url !== null && (typeof e.url !== "string" || e.url.length > EVENT_LIMITS.url || !/^https:\/\/\S+$/.test(e.url))) problems.push(`${where}.url must be null or an https URL`);
  if (!Array.isArray(e.labels) || e.labels.length > EVENT_LIMITS.labels || e.labels.some((label) => !line(label, EVENT_LIMITS.label) || /\s/.test(label))) {
    problems.push(`${where}.labels must be at most ${EVENT_LIMITS.labels} labels of at most ${EVENT_LIMITS.label} characters without spaces`);
  } else if (new Set(e.labels).size !== e.labels.length) problems.push(`${where}.labels repeats a label`);
  const actorIds = /* @__PURE__ */ new Set();
  if (!Array.isArray(e.actors) || e.actors.length > EVENT_LIMITS.actors) problems.push(`${where}.actors must be a list of at most ${EVENT_LIMITS.actors}`);
  else {
    const seen = /* @__PURE__ */ new Set();
    for (const [index, actor] of e.actors.entries()) {
      const at = `${where}.actors[${index}]`;
      if (!plainObject(actor)) {
        problems.push(`${at} is not an object`);
        continue;
      }
      problems.push(...actorProblems(actor, at));
      if (typeof actor.id === "string") actorIds.add(actor.id);
      const key = `${String(actor.role)}\0${String(actor.id)}`;
      if (seen.has(key)) problems.push(`${at} repeats an actor`);
      seen.add(key);
    }
  }
  problems.push(...targetProblems(e, where), ...partProblems(e, where, actorIds), ...factsProblems(e, where, actorIds));
  if (typeof e.hash !== "string" || !HASH.test(e.hash)) problems.push(`${where}.hash must be sha256: and 64 hex digits`);
  else if (problems.length === 0) {
    const { hash, ...rest } = e;
    if (eventHash(rest) !== hash) problems.push(`${where}.hash is not the eventHash of its fields`);
  }
  return problems;
}
var RESULT_KEYS = ["source", "account", "owner", "events", "cursor", "more", "trust"];
var EXTRA_KEYS = ["scope", "refused", "failed", "removals", "gap", "cost", "plugin", "asOf"];
function removalProblems(result) {
  if (!plainObject(result) || result["removals"] === void 0) return [];
  const list = result["removals"];
  if (!Array.isArray(list) || list.length > EVENT_LIMITS.refused) return [`the result's removals must be a list of at most ${EVENT_LIMITS.refused}`];
  const problems = [];
  const asOf = isoUtc(result["asOf"]) ? Date.parse(result["asOf"]) : void 0;
  const seen = /* @__PURE__ */ new Set();
  for (const [index, entry] of list.entries()) {
    const at = `removals[${index}]`;
    if (!plainObject(entry)) {
      problems.push(`${at} is not an object`);
      continue;
    }
    for (const key of Object.keys(entry)) if (!["external_id", "at", "reason"].includes(key)) problems.push(`${at} has the field "${key}", which the contract does not define`);
    const id = entry["external_id"];
    if (!line(id, EVENT_LIMITS.externalId)) problems.push(`${at}.external_id must be a non-empty id of at most ${EVENT_LIMITS.externalId} characters`);
    else if (seen.has(id)) problems.push("the result's removals lists one event twice");
    else seen.add(id);
    if (!isoUtc(entry["at"])) problems.push(`${at}.at must be a UTC ISO date-time ending in Z`);
    else if (asOf !== void 0 && Date.parse(entry["at"]) > asOf) problems.push(`${at}.at is later than the page's asOf`);
    if (!REMOVAL_REASONS.includes(entry["reason"])) problems.push(`${at}.reason must be one of ${REMOVAL_REASONS.join(", ")}`);
  }
  const failed = result["failed"];
  if (Array.isArray(failed) && failed.some((entry) => plainObject(entry) && typeof entry["external_id"] === "string" && seen.has(entry["external_id"]))) {
    problems.push("an event is both removed and failed: a removal is final, so nothing is retried");
  }
  return problems;
}
function extraProblems(result, ids) {
  const problems = [];
  if (result["scope"] !== void 0) {
    const scope = result["scope"];
    let canonical = false;
    try {
      canonical = plainObject(scope) && JSON.stringify(canonicalScope(scope)) === JSON.stringify(scope);
    } catch {
      canonical = false;
    }
    if (!canonical || scopeProblems(scope, Object.keys(scope)).length > 0) problems.push("the result's scope must be a scope in canonical form: keys sorted, each list sorted without repeats");
  }
  const entries = (name, max, check) => {
    const list = result[name];
    if (list === void 0) return;
    if (!Array.isArray(list) || list.length > max) {
      problems.push(`the result's ${name} must be a list of at most ${max}`);
      return;
    }
    for (const [index, entry] of list.entries()) {
      const at = `${name}[${index}]`;
      if (!plainObject(entry)) {
        problems.push(`${at} is not an object`);
        continue;
      }
      if (!line(entry["external_id"], EVENT_LIMITS.externalId)) problems.push(`${at}.external_id must be a non-empty id of at most ${EVENT_LIMITS.externalId} characters`);
      else if (ids.has(entry["external_id"])) problems.push(`${at} is also among the result's events`);
      problems.push(...check(entry, at));
    }
  };
  entries("refused", EVENT_LIMITS.refused, (entry, at) => [
    ...Object.keys(entry).filter((key) => !["external_id", "reason", "detail"].includes(key)).map((key) => `${at} has the field "${key}", which the contract does not define`),
    ...REFUSAL_REASONS.includes(entry["reason"]) ? [] : [`${at}.reason must be one of ${REFUSAL_REASONS.join(", ")}`],
    ...entry["detail"] === void 0 || line(entry["detail"], EVENT_LIMITS.detail) ? [] : [`${at}.detail must be one line of at most ${EVENT_LIMITS.detail} characters`]
  ]);
  entries("failed", EVENT_LIMITS.failed, (entry, at) => [
    ...Object.keys(entry).filter((key) => !["external_id", "code", "retryAfterSec"].includes(key)).map((key) => `${at} has the field "${key}", which the contract does not define`),
    ...typeof entry["code"] === "string" && CODE.test(entry["code"]) ? [] : [`${at}.code must be an error code such as RATE_LIMITED`],
    ...entry["retryAfterSec"] === void 0 || typeof entry["retryAfterSec"] === "number" && Number.isInteger(entry["retryAfterSec"]) && entry["retryAfterSec"] >= 0 ? [] : [`${at}.retryAfterSec must be a whole number of seconds`]
  ]);
  for (const name of ["refused", "failed"]) {
    const list = result[name];
    if (Array.isArray(list)) {
      const listed = list.map((entry) => plainObject(entry) ? entry["external_id"] : void 0);
      if (new Set(listed).size !== listed.length) problems.push(`the result's ${name} lists one event twice`);
    }
  }
  if (Array.isArray(result["refused"]) && Array.isArray(result["failed"])) {
    const refused = new Set(result["refused"].map((entry) => plainObject(entry) ? entry["external_id"] : void 0));
    if (result["failed"].some((entry) => plainObject(entry) && refused.has(entry["external_id"]))) problems.push("an event is both refused and failed");
  }
  problems.push(...removalProblems(result));
  if (result["gap"] !== void 0) {
    const gap = result["gap"];
    if (!plainObject(gap) || Object.keys(gap).some((key) => key !== "reason" && key !== "since") || !GAP_REASONS.includes(gap["reason"]) || !isoUtc(gap["since"])) {
      problems.push(`the result's gap must be { reason: ${GAP_REASONS.join(" or ")}, since: a UTC ISO date-time }`);
    }
  }
  if (result["cost"] !== void 0) {
    const cost = result["cost"];
    const units = plainObject(cost) ? cost["units"] : void 0;
    const unitsOk = Array.isArray(units) && units.length <= EVENT_LIMITS.costUnits && units.every((unit) => plainObject(unit) && Object.keys(unit).every((key) => key === "per" || key === "count") && typeof unit["per"] === "string" && UNIT.test(unit["per"]) && typeof unit["count"] === "number" && Number.isInteger(unit["count"]) && unit["count"] >= 0);
    const usd = plainObject(cost) ? cost["usd"] : void 0;
    const usdOk = usd === void 0 || typeof usd === "number" && Number.isFinite(usd) && usd >= 0;
    if (!plainObject(cost) || Object.keys(cost).some((key) => key !== "units" && key !== "usd") || !unitsOk || !usdOk) {
      problems.push("the result's cost must be { units: [{ per, count }], usd? }, with whole counts and a non-negative usd");
    }
  }
  if (result["plugin"] !== void 0 && !line(result["plugin"], 214)) problems.push("the result's plugin must be the plugin's package name or id");
  if (result["asOf"] !== void 0 && !isoUtc(result["asOf"])) problems.push("the result's asOf must be a UTC ISO date-time ending in Z");
  return problems;
}
function resultProblems(result, limit = PAGE.max, maxBytes = MAX_PAGE_BYTES) {
  if (!plainObject(result)) return ["the result is not an object"];
  const problems = [];
  for (const key of Object.keys(result)) if (!RESULT_KEYS.includes(key) && !EXTRA_KEYS.includes(key)) problems.push(`the result has the field "${key}", which the contract does not define`);
  const { source, account } = result;
  const named = line(source, EVENT_LIMITS.source) && SOURCE_PATTERN.test(source);
  if (!named) problems.push("the result's source must be a lowercase name such as gmail");
  if (!line(account, EVENT_LIMITS.account)) problems.push(`the result's account must be a non-empty name of at most ${EVENT_LIMITS.account} characters`);
  const owner = result["owner"];
  problems.push(...ownerShapeProblems(owner, "the result's owner"));
  const cursor = result["cursor"];
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > EVENT_LIMITS.cursor) problems.push(`the result's cursor must be a non-empty string of at most ${EVENT_LIMITS.cursor} characters`);
  if (typeof result["more"] !== "boolean") problems.push("the result's more must be true or false");
  if (result["trust"] !== TRUST) problems.push(`the result's trust must be "${TRUST}"`);
  const events = result["events"];
  if (!Array.isArray(events)) return [...problems, "the result's events must be a list"];
  if (events.length > limit) problems.push(`the result has ${events.length} events, over the limit of ${limit}`);
  for (const [index, event] of events.entries()) {
    problems.push(...eventProblems(event, `events[${index}]`));
    if (plainObject(event) && named && event["source"] !== source) problems.push(`events[${index}] names another source than the result`);
    if (plainObject(event) && typeof account === "string" && event["account"] !== account) problems.push(`events[${index}] names another account than the result`);
  }
  const times = events.map((event) => Date.parse(plainObject(event) ? String(event["occurred_at"]) : ""));
  if (times.some((time, index) => index > 0 && time < times[index - 1])) problems.push("the result's events are not oldest first");
  const ids = events.map((event) => plainObject(event) ? `${String(event["source"])}:${String(event["account"])}:${String(event["external_id"])}` : "");
  if (new Set(ids).size !== ids.length) problems.push("the result lists one event twice");
  problems.push(...extraProblems(result, new Set(events.map((event) => plainObject(event) ? String(event["external_id"]) : ""))));
  const bytes = Buffer.byteLength(JSON.stringify(result));
  if (bytes > maxBytes) problems.push(`the result is ${bytes} bytes of JSON, over ${maxBytes}`);
  return problems;
}

export {
  secretKinds,
  EVENTS_LIST,
  EVENT_KINDS,
  EXTENSION_SEGMENT_MAX,
  EXTENSION_NAME,
  EXTENSION_KIND,
  isExtensionName,
  isEventKind,
  extensionNamespace,
  isEventKindIn,
  sourceNamespace,
  EVENT_LIMITS,
  PAGE,
  MAX_PAGE_BYTES,
  MAX_BYTES,
  FIRST_RUN_HOURS,
  TRUST,
  ACTOR_KINDS,
  ACTOR_ROLES,
  AUTHOR_ROLES,
  IDENTITY_STRENGTHS,
  AUDIENCES,
  FACT_TYPES,
  COMMITMENT_STATES,
  ATTENDANCE_RESPONSES,
  REFUSAL_REASONS,
  REMOVAL_REASONS,
  GAP_REASONS,
  ERROR_CODES,
  PROPOSED_CODES,
  ERROR_ALIASES,
  CONTRACT1_CODES,
  canonicalCode,
  SourceError,
  parseSourceError,
  SINCE_PATTERN,
  SOURCE_PATTERN,
  SCOPE_KEY_PATTERN,
  sinceTime,
  scopeProblems,
  parseEventsListInput,
  startTime,
  cut,
  eventHash,
  makeEvent,
  oldestFirst,
  fitPage,
  screenEvents,
  PROBE,
  PROBE_LIMITS,
  parseProbeInput,
  probeResult,
  probeResultProblems,
  eventsListResult,
  factProblems,
  eventProblems,
  removalProblems,
  resultProblems
};
