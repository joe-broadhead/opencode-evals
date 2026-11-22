import { createHash, randomBytes } from "node:crypto"

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/** A 26-character Crockford ULID: 10 characters of milliseconds, 16 of randomness. */
export function ulid(ms = Date.now()) {
  let time = ""
  let t = Math.max(0, Math.floor(ms))
  for (let i = 0; i < 10; i += 1) {
    time = CROCKFORD[t % 32] + time
    t = Math.floor(t / 32)
  }
  const bytes = randomBytes(16)
  let rand = ""
  // 256 is a multiple of 32, so masking keeps every character equally likely.
  for (let i = 0; i < 16; i += 1) rand += CROCKFORD[bytes[i] & 31]
  return time + rand
}

export const RECORD_ID = /^rec_[0-9A-HJKMNP-TV-Z]{26}$/

/** `rec_` + ULID, minted by the service (contract §2.3). */
export function recordId(ms) {
  return `rec_${ulid(ms)}`
}

/** `evt_` + the first 24 hex of sha256(`source:account:external_id`): ingest is idempotent. */
export function eventId(source, account, externalId) {
  return `evt_${sha256(`${source}:${account}:${externalId}`).slice(0, 24)}`
}

export function sha256(text) {
  return createHash("sha256").update(text).digest("hex")
}
