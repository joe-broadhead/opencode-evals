/**
 * Keyed marks (S2 review, M3; design §8.5). A rejection, a forgotten knowledge
 * key and a page that needs a rebuild are remembered as keyed hashes, never as
 * text. One key per space, made on first use and kept in `meta`.
 */
import { createHmac, randomBytes } from "node:crypto"

/** The keyed hash of one mark. */
export function markKey(handle, kind, value) {
  let row = handle.get("select value from meta where key = 'claims_mark_key'")
  if (!row) {
    const made = randomBytes(32).toString("hex")
    handle.run("insert into meta (key, value) values ('claims_mark_key', ?) on conflict(key) do nothing", made)
    row = handle.get("select value from meta where key = 'claims_mark_key'")
  }
  return createHmac("sha256", row.value).update(`${kind}\u0000${value}`).digest("hex")
}

export function writeMark(handle, kind, value, at) {
  const key = markKey(handle, kind, value)
  handle.run("insert into claim_marks (key, kind, created) values (?, ?, ?) on conflict(key) do nothing", key, kind, at)
  return key
}

export function hasMark(handle, kind, value) {
  return Boolean(handle.get("select 1 from claim_marks where key = ? and kind = ?", markKey(handle, kind, value), kind))
}
