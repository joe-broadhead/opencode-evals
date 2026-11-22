/**
 * The reservation proof a verified host action carries to the control plane
 * (docs/design/p2-control.md, revision 1).
 *
 * A control-plane act is G2-P — a person only (DESIGN-CRUD §3.3): `share.transfer`,
 * `share.decide` and `space.visibility`. Records verifies the
 * host's `jelly-act+jwt` and spends it at the grant door, so records is the one
 * service that can say "this person pressed this act, once". This module is how
 * it says so to control:
 *
 *   p2r1.<base64url claims>.<base64url HMAC-SHA256 over "p2r1.claims">
 *   claims {v, act, in, user, host, jti, iat, exp}
 *
 * It is **not** a second grant. A reservation authorises nothing on its own: it
 * names what records has already spent, and the service that applies the act
 * spends it again, in its own ledger and its own transaction, so one press is
 * one change. Its life is at most a minute.
 *
 * Four copies carry this file, byte for byte identical (`npm run check:copies`):
 * the plugin, records, the gateway and control. It is self-contained —
 * `node:crypto` only, no I/O, no service imports. Records signs; the gateway and
 * control verify; the plugin only carries what records answered, and never
 * verifies or mints one.
 *
 * Nothing about a proof is logged: a verifier that explains which byte failed
 * tells a caller which byte to change.
 */
import { createHash, createHmac, timingSafeEqual } from "node:crypto"

/** The token's version marker, so a format change is a new prefix, never a guess. */
export const P2_PREFIX = "p2r1"
/** A proof is small: three parts, one of them a 32-byte MAC. */
export const MAX_P2_BYTES = 4096
/** The claims' own ceiling (docs/design/p2-control.md §2). */
export const MAX_ACT_BYTES = 128
export const MAX_USER_BYTES = 200
export const MAX_HOST_BYTES = 128
export const MAX_JTI_BYTES = 128
/** A reservation's life, and the skew allowed each way. */
export const MAX_LIFETIME_SECONDS = 60
export const CLOCK_SKEW_SECONDS = 5
/** The shortest shared key this accepts: a 256-bit secret. */
export const MIN_KEY_BYTES = 32

const BASE64URL = /^[A-Za-z0-9_-]+$/
const DIGEST = /^[A-Za-z0-9_-]{43}$/
const JTI = /^[A-Za-z0-9_-]{22,128}$/

/**
 * The shared key, from the setting: a 32-byte-or-longer secret, or null. An
 * absent or short key turns the whole path off (records issues nothing, the
 * gateway and control refuse everything that carries a proof).
 *
 * @param {unknown} value
 * @returns {Buffer | null}
 */
export function readP2Key(value) {
  if (typeof value !== "string") return null
  const key = Buffer.from(value.trim(), "utf8")
  if (key.length < MIN_KEY_BYTES) return null
  return key
}

/**
 * The digest a claim's `in` is: base64url SHA-256 over the **canonical JSON** of
 * the act's input, exactly as the host signed it (`actionInputDigest`, ADR §4.2).
 *
 * A verifier that is not given the canonical bytes cannot compute this value: it
 * is handed the bytes and hashes them, so a caller that sends a non-canonical
 * form fails the digest rather than being re-canonicalised into a match.
 *
 * @param {string | Buffer} bytes
 */
export function inputDigest(bytes) {
  return createHash("sha256").update(typeof bytes === "string" ? Buffer.from(bytes, "utf8") : bytes).digest("base64url")
}

/** The token's signed half, so a verifier hashes the same bytes the signer did. */
function macOf(key, body) {
  return createHmac("sha256", key).update(body, "ascii").digest("base64url")
}

/**
 * Issue one reservation: what records spent, for whom, and for how long.
 *
 * @param {{ key: Buffer, act: string, in: string, user: string, host: string, jti: string, now?: number, lifetime?: number }} input
 * @returns {string}
 */
export function issueReservation({ key, act, in: digest, user, host, jti, now = Math.floor(Date.now() / 1000), lifetime = MAX_LIFETIME_SECONDS } = {}) {
  if (!Buffer.isBuffer(key) || key.length < MIN_KEY_BYTES) throw new TypeError("issueReservation: a shared key of at least 32 bytes is required")
  if (typeof act !== "string" || !act) throw new TypeError("issueReservation: an act is required")
  if (typeof digest !== "string" || !DIGEST.test(digest)) throw new TypeError("issueReservation: the input digest is 43 base64url characters")
  if (typeof user !== "string" || !user) throw new TypeError("issueReservation: the person is required")
  if (typeof host !== "string" || !host) throw new TypeError("issueReservation: the host is required")
  if (typeof jti !== "string" || !JTI.test(jti)) throw new TypeError("issueReservation: the grant's jti is required")
  const seconds = Number.isSafeInteger(lifetime) ? Math.min(Math.max(lifetime, 1), MAX_LIFETIME_SECONDS) : MAX_LIFETIME_SECONDS
  const claims = { v: 1, act, in: digest, user, host, jti, iat: now, exp: now + seconds }
  const body = `${P2_PREFIX}.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}`
  return `${body}.${macOf(key, body)}`
}

/**
 * Verify one reservation proof, and nothing else: the caller still checks that
 * the act, the input and the person are the ones it is acting for.
 *
 * @param {{ token: unknown, key: Buffer | null, now?: number }} input
 * @returns {{ ok: true, claims: object } | { ok: false, code: string, detail: string }}
 */
export function verifyReservation({ token, key, now = Math.floor(Date.now() / 1000) } = {}) {
  if (!Buffer.isBuffer(key) || key.length < MIN_KEY_BYTES) return refuse("p2_unavailable", "no reservation key is configured")
  if (typeof token !== "string" || !token) return refuse("p2_malformed", "the reservation is not a string")
  if (Buffer.byteLength(token, "utf8") > MAX_P2_BYTES) return refuse("p2_malformed", `the reservation is over ${MAX_P2_BYTES} bytes`)
  const parts = token.split(".")
  if (parts.length !== 3) return refuse("p2_malformed", "the reservation is not three dot-separated parts")
  const [prefix, claimsPart, macPart] = parts
  if (prefix !== P2_PREFIX) return refuse("p2_malformed", "the reservation is not a p2r1 proof")
  if (!BASE64URL.test(claimsPart) || !BASE64URL.test(macPart)) return refuse("p2_malformed", "a reservation part is not base64url")
  if (Buffer.from(claimsPart, "base64url").toString("base64url") !== claimsPart) return refuse("p2_malformed", "a reservation part is not canonical base64url")
  const given = Buffer.from(macPart, "base64url")
  const expected = Buffer.from(macOf(key, `${prefix}.${claimsPart}`), "base64url")
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return refuse("p2_signature", "the reservation's signature does not verify")
  let claims
  try {
    claims = JSON.parse(Buffer.from(claimsPart, "base64url").toString("utf8"))
  } catch {
    return refuse("p2_malformed", "the claims are not JSON")
  }
  const problem = claimProblem(claims)
  if (problem) return refuse("p2_malformed", problem)
  if (!(claims.exp - claims.iat > 0) || claims.exp - claims.iat > MAX_LIFETIME_SECONDS) return refuse("p2_time", `the lifetime is not 1 to ${MAX_LIFETIME_SECONDS} seconds`)
  if (claims.iat > now + CLOCK_SKEW_SECONDS) return refuse("p2_time", "the reservation is from the future")
  if (now > claims.exp + CLOCK_SKEW_SECONDS) return refuse("p2_expired", "the reservation has expired")
  return { ok: true, claims }
}

function refuse(code, detail) {
  return { ok: false, code, detail }
}

/** Every claim this format requires, with its type and length; null when all are there. */
function claimProblem(claims) {
  if (!claims || typeof claims !== "object" || Array.isArray(claims)) return "the claims are not an object"
  if (claims.v !== 1) return "the reservation's version is not 1"
  for (const [name, max] of [["act", MAX_ACT_BYTES], ["user", MAX_USER_BYTES], ["host", MAX_HOST_BYTES]]) {
    if (typeof claims[name] !== "string" || !claims[name] || claims[name].length > max) return `${name} is not a string of 1 to ${max} characters`
  }
  if (typeof claims.in !== "string" || !DIGEST.test(claims.in)) return "in is not 43 base64url characters"
  if (typeof claims.jti !== "string" || !JTI.test(claims.jti)) return "jti is not 22 to 128 base64url characters"
  for (const name of ["iat", "exp"]) if (!Number.isSafeInteger(claims[name])) return `${name} is not a whole number of seconds`
  return null
}
