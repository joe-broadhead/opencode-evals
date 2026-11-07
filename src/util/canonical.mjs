// Canonical JSON and digests. Every hash in the tool goes through here, so two records of the same
// object are byte-identical however their keys were ordered.
import { createHash } from "node:crypto"

/** JSON with object keys sorted, no whitespace. Arrays keep their order (order is data). */
export function canonical(value) {
  const walk = (v) => {
    if (v === null || typeof v !== "object") return v
    if (Array.isArray(v)) return v.map(walk)
    const out = {}
    for (const key of Object.keys(v).sort()) {
      if (v[key] === undefined) continue
      out[key] = walk(v[key])
    }
    return out
  }
  return JSON.stringify(walk(value))
}

export const sha256 = (text) => createHash("sha256").update(text).digest("hex")
export const digestOf = (value) => sha256(canonical(value))
export const short = (hex, n = 12) => String(hex).slice(0, n)

/** A digest of a set of named files: sorted, so a moved file cannot change it. */
export const digestOfFiles = (files) => digestOf(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)))
