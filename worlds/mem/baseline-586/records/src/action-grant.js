/**
 * The verified-caller action grant (`jelly-act+jwt`), claims spec v1:
 * docs/design/adr-verified-caller-grants.md §4.1, §4.2 and §4.4. A host signs
 * one grant per click with its own Ed25519 key, over the digest of the exact
 * input it is asked to apply. Memory verifies it against public keys read from
 * a file.
 *
 * One library, several callers: the plugin, the records service, control and
 * the gateway each vendor a byte-identical copy (`npm run check:copies`), and
 * each service that applies an act keeps its own replay ledger. This file is
 * therefore self-contained: `node:crypto` only, no imports from the service
 * that carries it, and no I/O. The key file's reading is `action-grant-keys`.
 *
 * A check that fails returns `{ok: false, code}` with one of the §4.9 codes.
 * Nothing from the claims is read before the signature verifies, and nothing
 * about the token is logged: a verifier that explains why it refused is a
 * verifier that tells an attacker which byte to change.
 */
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto"

/** The package and target every act of this service is bound to (§4.1). */
export const GRANT_AUDIENCE = "@joe-broadhead/opencode-mem#engine"
/** The header `typ` Jelly's host writes, unless its key entry names another. */
export const GRANT_TYP = "jelly-act+jwt"
/** A grant is at most this many bytes: the size Jelly's relay allows (§4.1). */
export const MAX_GRANT_BYTES = 4096
/** The input is at most this many bytes of canonical JSON, and this deep (§4.4). */
export const MAX_INPUT_BYTES = 64 * 1024
export const MAX_INPUT_DEPTH = 16
/** A key file is refused whole past these limits (§4.3). */
export const MAX_KEYS_BYTES = 4 * 1024 * 1024
export const MAX_KEYS = 10_000
/** A grant's lifetime, and the skew allowed each way (§4.1). */
export const MAX_LIFETIME_SECONDS = 60
export const CLOCK_SKEW_SECONDS = 5
/** The route classes a host signs, weakest first. `view` never authorises an act. */
export const GRANT_CLASSES = Object.freeze({ chat: 1, local: 2 })
/**
 * The identity issuer of an API key or a console session (§4.5). A grant acts
 * only for a member of a host-signed identity, so a key entry that binds itself
 * to this issuer would turn every API key into a caller that can carry one: the
 * file is refused.
 */
export const API_KEY_ISSUER = "better-auth"
/** The JSON types an act may declare for one of its input keys. */
export const INPUT_TYPES = Object.freeze(["string", "integer", "boolean", "object", "array", "null"])

const BASE64URL = /^[A-Za-z0-9_-]+$/
const BASE64URL_43 = /^[A-Za-z0-9_-]{43}$/
/** A pulled_at that names an instant: the date, the time, and a zone. */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
const JTI = /^[A-Za-z0-9_-]{22,128}$/
const KEY_ALG = "EdDSA"
const KEY_CRV = "Ed25519"
const KEY_KTY = "OKP"

/** Why a value cannot be canonicalised: a lone surrogate, or a number that is not a safe integer. */
export class InputNotCanonical extends Error {
  constructor(message) {
    super(message)
    this.name = "InputNotCanonical"
  }
}

// ---------------------------------------------------------------------------
// §4.2 Canonicalisation and the input digest

/** The canonical JSON of an action input, byte for byte what the host signed. */
export function canonicalJson(value) {
  // A missing input is `null` (§4.2 rule 4).
  return writeCanonical(value === undefined ? null : value, 1)
}

function writeCanonical(value, depth) {
  if (depth > MAX_INPUT_DEPTH) throw new InputNotCanonical(`the input is nested deeper than ${MAX_INPUT_DEPTH}`)
  if (value === null) return "null"
  if (typeof value === "boolean") return value ? "true" : "false"
  if (typeof value === "number") {
    // Only safe integers: ECMAScript's number formatting never matters, so this
    // is RFC 8785 for the inputs Memory accepts (§4.2).
    if (!Number.isSafeInteger(value)) throw new InputNotCanonical("a number in the input is not a safe integer")
    return JSON.stringify(value)
  }
  if (typeof value === "string") return JSON.stringify(checkString(value))
  if (typeof value !== "object" || value === undefined) throw new InputNotCanonical(`an input value of type ${typeof value} cannot be canonicalised`)
  if (Array.isArray(value)) {
    const items = value.map((item) => {
      if (item === undefined) throw new InputNotCanonical("an array in the input holds undefined")
      return writeCanonical(item, depth + 1)
    })
    return `[${items.join(",")}]`
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) throw new InputNotCanonical("an input object is not a plain JSON object")
  // Members whose value is undefined are absent, as JSON.stringify writes them,
  // and keys sort by UTF-16 code unit, which is what `<` on strings compares.
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(checkString(key))}:${writeCanonical(value[key], depth + 1)}`).join(",")}}`
}

/** A string may hold no lone surrogate: JSON.stringify escapes one, and JCS forbids one. */
function checkString(value) {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit < 0xd800 || unit > 0xdfff) continue
    if (unit > 0xdbff) throw new InputNotCanonical("a string in the input holds a lone surrogate")
    const next = value.charCodeAt(index + 1)
    if (!(next >= 0xdc00 && next <= 0xdfff)) throw new InputNotCanonical("a string in the input holds a lone surrogate")
    index += 1
  }
  return value
}

/**
 * The grant's `in`: base64url, without padding, of SHA-256 over the UTF-8 bytes
 * of the canonical input. A missing input is `null` (§4.2).
 *
 * @throws {InputNotCanonical} for a lone surrogate or a number that is not a safe integer
 */
export function actionInputDigest(input) {
  return createHash("sha256").update(canonicalJson(input), "utf8").digest("base64url")
}

// ---------------------------------------------------------------------------
// §4.3 The key file (its reading from disk is action-grant-keys)

/**
 * The RFC 7638 thumbprint of a public key: SHA-256 over the required members
 * `crv`, `kty` and `x` in lexicographic order, base64url. It is the grant's
 * `kid` and the key file's `kid`, so a key file entry names itself.
 */
export function keyThumbprint(jwk) {
  if (!jwk || typeof jwk !== "object") throw new TypeError("keyThumbprint: a JWK is required")
  const members = ['"crv"', '"kty"', '"x"'].map((name) => {
    const value = jwk[name.slice(1, -1)]
    if (typeof value !== "string" || !value) throw new TypeError(`keyThumbprint: the JWK has no ${name}`)
    return `${name}:${JSON.stringify(value)}`
  })
  return createHash("sha256").update(`{${members.join(",")}}`, "utf8").digest("base64url")
}

/**
 * Parse and validate a key file (§4.3): the hosts' public keys and the members
 * that bind each to the identity issuer whose subjects its grants name.
 *
 * The whole file is refused when it is not valid JSON, holds a private member
 * `d`, repeats a `kid`, carries a `kid` that is not the key's thumbprint, holds
 * a key that is not Ed25519, or is over 4 MiB or 10,000 keys.
 *
 * @param {string} text the file's text
 * @param {{ audience?: string }} [options]
 * @returns {{ ok: true, entries: Array<object>, pulledAt: number | null } | { ok: false, error: string }}
 */
export function parseActionKeys(text, { audience = GRANT_AUDIENCE } = {}) {
  if (typeof text !== "string") return refuseKeys("the key file is not text")
  if (Buffer.byteLength(text, "utf8") > MAX_KEYS_BYTES) return refuseKeys(`the key file is over ${MAX_KEYS_BYTES} bytes`)
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return refuseKeys("the key file is not valid JSON")
  }
  if (!isPlainObject(parsed) || !Array.isArray(parsed.keys)) return refuseKeys('the key file is not {"keys": [...]}')
  if (hasPrivateMember(parsed)) return refuseKeys("the key file holds a private member d")
  if (parsed.keys.length > MAX_KEYS) return refuseKeys(`the key file holds more than ${MAX_KEYS} keys`)
  // The puller stamps when it last wrote the file (§4.3); the age limit reads
  // it, so a date the file cannot name is refused rather than guessed. Only a
  // full ISO 8601 timestamp with a zone names an instant: "2026" is a year,
  // not a time, and would read as one the age limit can trust.
  let pulledAt = null
  if (parsed.pulled_at !== undefined) {
    if (typeof parsed.pulled_at !== "string" || !ISO_TIMESTAMP.test(parsed.pulled_at) || !Number.isFinite(Date.parse(parsed.pulled_at))) {
      return refuseKeys("the key file's pulled_at is not a full ISO 8601 timestamp with a zone")
    }
    pulledAt = Date.parse(parsed.pulled_at)
  }
  const entries = []
  const seen = new Set()
  for (const raw of parsed.keys) {
    const entry = parseActionKey(raw, audience)
    if (!entry.ok) return entry
    if (seen.has(entry.value.kid)) return refuseKeys(`the key file repeats the kid ${entry.value.kid}`)
    seen.add(entry.value.kid)
    entries.push(entry.value)
  }
  return { ok: true, entries, pulledAt }
}

function refuseKeys(error) {
  return { ok: false, error }
}

function hasPrivateMember(value, depth = 0) {
  if (!value || typeof value !== "object" || depth > 4) return false
  if (!Array.isArray(value) && Object.hasOwn(value, "d")) return true
  return Object.values(value).some((child) => hasPrivateMember(child, depth + 1))
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function textOf(value, max = 128) {
  return typeof value === "string" && value.length >= 1 && value.length <= max ? value : null
}

/** One entry of the key file, with the public key built and checked by Node. */
function parseActionKey(raw, audience) {
  if (!isPlainObject(raw)) return refuseKeys("a key entry is not an object")
  const where = typeof raw.kid === "string" ? ` (${raw.kid.slice(0, 64)})` : ""
  if (raw.kty !== KEY_KTY || raw.crv !== KEY_CRV) return refuseKeys(`a key entry is not ${KEY_KTY}/${KEY_CRV}${where}`)
  if (typeof raw.x !== "string" || !BASE64URL_43.test(raw.x)) return refuseKeys(`a key entry's x is not 43 base64url characters${where}`)
  if (raw.alg !== undefined && raw.alg !== KEY_ALG) return refuseKeys(`a key entry's alg is not ${KEY_ALG}${where}`)
  if (raw.use !== undefined && raw.use !== "sig") return refuseKeys('a key entry\'s use is not "sig"')
  const iss = textOf(raw.iss)
  if (!iss) return refuseKeys(`a key entry has no iss, or one that is not 1 to 128 characters${where}`)
  const mbrIss = textOf(raw.mbr_iss)
  if (!mbrIss) return refuseKeys(`a key entry has no mbr_iss, or one that is not 1 to 128 characters${where}`)
  // §4.5: an API key or a console session never carries a grant, so no key may
  // bind itself to that issuer.
  if (mbrIss.toLowerCase() === API_KEY_ISSUER) {
    return refuseKeys(`a key entry names mbr_iss ${API_KEY_ISSUER}: an API key never carries a grant`)
  }
  if (raw.aud !== undefined && !textOf(raw.aud)) return refuseKeys(`a key entry's aud is not 1 to 128 characters${where}`)
  if (raw.typ !== undefined && !textOf(raw.typ)) return refuseKeys(`a key entry's typ is not 1 to 128 characters${where}`)
  if (raw.extra_input !== undefined && (!Array.isArray(raw.extra_input) || raw.extra_input.some((key) => !textOf(key)))) {
    return refuseKeys(`a key entry's extra_input is not a list of input keys${where}`)
  }
  // Jelly's answer 7: `jellySpeaker` is the only key a host adds before it
  // signs. An entry that would let another key ride along is refused whole.
  if (Array.isArray(raw.extra_input) && raw.extra_input.some((key) => key !== "jellySpeaker")) {
    return refuseKeys(`a key entry's extra_input names a key a host does not add${where}`)
  }
  const thumbprint = keyThumbprint(raw)
  if (raw.kid !== thumbprint) return refuseKeys("a key entry's kid is not the thumbprint of its key")
  let key
  try {
    key = createPublicKey({ key: { kty: KEY_KTY, crv: KEY_CRV, x: raw.x }, format: "jwk" })
  } catch {
    return refuseKeys(`a key entry's x is not an Ed25519 public key${where}`)
  }
  return {
    ok: true,
    value: {
      kid: thumbprint,
      iss,
      mbrIss,
      aud: textOf(raw.aud) ?? audience,
      typ: textOf(raw.typ) ?? GRANT_TYP,
      extraInput: Array.isArray(raw.extra_input) ? [...new Set(raw.extra_input)] : [],
      key,
    },
  }
}

// ---------------------------------------------------------------------------
// §4.4 The verifier

/**
 * Verify one grant for one act and one input.
 *
 * @param {object} options
 * @param {unknown} options.grant the compact JWS the host signed
 * @param {unknown} options.input the input the caller asks to apply
 * @param {string} options.act the act being called
 * @param {Record<string, { minClass?: "chat" | "local", inputKeys?: string[] }>} options.allowed
 *   the acts this service applies now, and each act's closed input schema
 * @param {{ entries: Array<object> }} options.keys the loaded key file
 * @param {string} [options.audience] this service's audience (§4.1)
 * @param {number} [options.now] the clock, in seconds
 * @returns {{ ok: true, claims: object, entry: object } | { ok: false, code: string, detail: string }}
 */
export function verifyActionGrant({ grant, input, act, allowed = {}, keys = null, audience = GRANT_AUDIENCE, now = Math.floor(Date.now() / 1000) } = {}) {
  // 1. Size and shape.
  if (typeof grant !== "string") return refuse("grant_malformed", "the grant is not a string")
  if (Buffer.byteLength(grant, "utf8") > MAX_GRANT_BYTES) return refuse("grant_malformed", `the grant is over ${MAX_GRANT_BYTES} bytes`)
  const parts = grant.split(".")
  if (parts.length !== 3) return refuse("grant_malformed", "the grant is not three dot-separated parts")
  const [headerPart, payloadPart, signaturePart] = parts
  if (!BASE64URL.test(headerPart) || !BASE64URL.test(payloadPart)) return refuse("grant_malformed", "a grant part is not base64url")
  if (!isStrictBase64url(headerPart) || !isStrictBase64url(payloadPart)) return refuse("grant_malformed", "a grant part is not canonical base64url")
  // The signature's shape is checked after the header: `alg: none` carries an empty one.
  if (signaturePart !== "" && (!BASE64URL.test(signaturePart) || !isStrictBase64url(signaturePart))) {
    return refuse("grant_malformed", "the signature is not canonical base64url")
  }

  // The input is read last, after the signature verifies: a caller with no key
  // learns nothing about how inputs are handled. Its canonical form is at most
  // 64 KiB of JSON, nested at most 16 deep (§4.4 step 1), and a lone surrogate
  // or a number that is not a safe integer is step 10's business.

  // 2. Header: exactly alg, typ and kid, so no `jwk`, `jku`, `x5u`, `x5c`, `crit` or `b64` can ride along.
  const header = parsePart(headerPart)
  if (!isPlainObject(header)) return refuse("grant_malformed", "the header is not a JSON object")
  const headerKeys = Object.keys(header).sort()
  if (headerKeys.length !== 3 || headerKeys[0] !== "alg" || headerKeys[1] !== "kid" || headerKeys[2] !== "typ") {
    return refuse("grant_alg", "the header is not exactly alg, typ and kid")
  }
  if (header.alg !== KEY_ALG) return refuse("grant_alg", `alg is not ${KEY_ALG}`)

  // 3. Key: from the file, never from the token.
  const entries = Array.isArray(keys?.entries) ? keys.entries : []
  if (entries.length === 0) return refuse("grant_unavailable", "no action key is loaded")
  // §4.3: a file older than the operator's limit no longer verifies a grant.
  // A revoked host must stop acting, and a stale pull must never look fresh.
  if (keys?.stale === true) return refuse("grant_keys_stale", "the action key file is older than the allowed age")
  if (typeof header.kid !== "string") return refuse("grant_malformed", "the header has no kid")
  const entry = entries.find((candidate) => candidate.kid === header.kid)
  if (!entry) return refuse("grant_unknown_key", "the kid is not in the key file")
  if (header.typ !== entry.typ) return refuse("grant_alg", "the header's typ is not the key entry's")

  // 4. Signature: Ed25519 over the ASCII bytes of header.payload, 64 bytes.
  const signature = signaturePart === "" ? null : Buffer.from(signaturePart, "base64url")
  if (!signature || signature.length !== 64) return refuse("grant_signature", "the signature is not 64 bytes")
  let signed = false
  try {
    signed = verifySignature(null, Buffer.from(`${headerPart}.${payloadPart}`, "ascii"), entry.key, signature)
  } catch {
    signed = false
  }
  if (!signed) return refuse("grant_signature", "the signature does not verify")

  // 5. Claim types.
  const claims = parsePart(payloadPart)
  if (!isPlainObject(claims)) return refuse("grant_malformed", "the payload is not a JSON object")
  const claimProblem = claimTypeProblem(claims)
  if (claimProblem) return refuse("grant_malformed", claimProblem)

  // 6. Issuer and audience.
  if (claims.iss !== entry.iss) return refuse("grant_issuer", "iss is not the key entry's host")
  if (claims.aud !== entry.aud && claims.aud !== audience) return refuse("grant_audience", "aud is not this package's engine")

  // 7. Time: at most 60 s, and within 5 s of this clock either way.
  if (!(claims.exp - claims.iat > 0) || claims.exp - claims.iat > MAX_LIFETIME_SECONDS) return refuse("grant_time", `the lifetime is not 1 to ${MAX_LIFETIME_SECONDS} seconds`)
  if (claims.iat > now + CLOCK_SKEW_SECONDS) return refuse("grant_time", "iat is in the future")
  if (now > claims.exp + CLOCK_SKEW_SECONDS) return refuse("grant_expired", "the grant has expired")

  // 8. Action: allowed here, and the one being called.
  if (typeof act !== "string" || !Object.hasOwn(allowed, act)) return refuse("grant_action", "this act is not enabled")
  if (claims.act !== act) return refuse("grant_action", "the grant is for another act")

  // 9. Class: chat or local, meeting the act's minimum. view never authorises
  // an act, and an act whose own declaration names another class is refused
  // rather than read as the weakest one: a typo must fail closed.
  const declaredClass = allowed[act]?.minClass
  if (typeof declaredClass !== "string" || !Object.hasOwn(GRANT_CLASSES, declaredClass)) {
    return refuse("grant_action", "the act's declared class is not one a grant can meet")
  }
  const minimum = GRANT_CLASSES[declaredClass]
  const given = Object.hasOwn(GRANT_CLASSES, claims.cls) ? GRANT_CLASSES[claims.cls] : undefined
  if (!given || given < minimum) return refuse("grant_class", "the grant's route class is weaker than the act needs")

  // 10. Input: its canonical form, the act's closed schema, the host's extra
  // keys, and the digest.
  let canonical
  try {
    canonical = canonicalJson(input)
  } catch (error) {
    if (!(error instanceof InputNotCanonical)) throw error
    return refuse(/nested deeper/.test(error.message) ? "grant_malformed" : "grant_input", error.message)
  }
  if (Buffer.byteLength(canonical, "utf8") > MAX_INPUT_BYTES) return refuse("grant_malformed", `the input is over ${MAX_INPUT_BYTES} bytes`)
  const schema = inputKeysProblem(input, allowed[act]?.inputKeys, entry.extraInput)
  if (schema) return refuse(schema.code, schema.detail)
  if (claims.in !== createHash("sha256").update(canonical, "utf8").digest("base64url")) return refuse("grant_input", "the digest is not this input's")

  return { ok: true, claims, entry }
}

function refuse(code, detail) {
  return { ok: false, code, detail }
}

/** Strict base64url: no padding, and re-encoding gives the same string. */
function isStrictBase64url(value) {
  if (typeof value !== "string" || value.length === 0 || !BASE64URL.test(value)) return false
  return Buffer.from(value, "base64url").toString("base64url") === value
}

function parsePart(value) {
  try {
    return JSON.parse(Buffer.from(value, "base64url").toString("utf8"))
  } catch {
    return undefined
  }
}

/** Every claim §4.1 requires, with its type; null when they are all there. */
function claimTypeProblem(claims) {
  for (const [name, min, max] of [["iss", 1, 128], ["dev", 1, 128], ["mbr", 1, 128]]) {
    if (typeof claims[name] !== "string" || claims[name].length < min || claims[name].length > max) return `${name} is not a string of ${min} to ${max} characters`
  }
  if (typeof claims.aud !== "string" || !claims.aud) return "aud is not a string"
  if (typeof claims.act !== "string" || !claims.act) return "act is not a string"
  if (typeof claims.in !== "string" || !BASE64URL_43.test(claims.in)) return "in is not 43 base64url characters"
  if (claims.cls !== "chat" && claims.cls !== "local" && claims.cls !== "view") return "cls is not chat, local or view"
  if (typeof claims.jti !== "string" || !JTI.test(claims.jti)) return "jti is not 22 to 128 base64url characters"
  for (const name of ["iat", "exp"]) if (!Number.isSafeInteger(claims[name])) return `${name} is not a whole number of seconds`
  return null
}

/**
 * The input must hold only the act's declared keys and the keys the host added
 * before signing (the entry's `extra_input`), and every declared key it holds
 * must have the type the act declared for it. Which declared keys must be
 * present is the act's own business (`run`), because some are conditional.
 *
 * @param {unknown} input
 * @param {Record<string, string>} declared each input key and its JSON type
 * @param {string[]} extraInput the keys the host adds before signing
 * @returns {{ code: string, detail: string } | null}
 */
function inputKeysProblem(input, declared, extraInput) {
  const schema = isPlainObject(declared) ? declared : {}
  // A declared type this build does not know means the act cannot be applied as
  // declared: refuse the act, never guess a permissive type.
  for (const [name, type] of Object.entries(schema)) {
    if (typeof type !== "string" || !INPUT_TYPES.includes(type)) return { code: "grant_action", detail: `the act declares ${name} with a type this build does not know` }
  }
  // A missing input is null (§4.2 rule 4): an act with no input has no keys.
  if (input === null || input === undefined) return null
  if (!isPlainObject(input)) return { code: "grant_input", detail: "the input is not an object" }
  const permitted = new Set([...Object.keys(schema), ...extraInput])
  for (const [key, value] of Object.entries(input)) {
    if (!permitted.has(key)) return { code: "grant_input", detail: `the input holds ${key}, which the act does not declare` }
    if (!Object.hasOwn(schema, key)) continue
    if (!matchesType(value, schema[key])) return { code: "grant_input", detail: `${key} is not a ${schema[key]}` }
  }
  return null
}

/** One input value against its declared JSON type. */
function matchesType(value, type) {
  if (type === "null") return value === null
  if (type === "array") return Array.isArray(value)
  if (type === "object") return isPlainObject(value)
  if (type === "integer") return Number.isSafeInteger(value)
  return typeof value === type
}
