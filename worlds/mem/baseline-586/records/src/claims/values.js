/**
 * Canonical values (docs/design/memory-routines-v1.md §4.2): a value that two
 * copies of one fact agree on. A value is an enum, an entity, a date, or a
 * phrase, folded and trimmed so case and spacing do not make a new claim. It is
 * kept in full: a cut would merge two values that differ only at the end
 * (review L).
 */

/** Folded, one line, no outer punctuation, in full. */
export function canonicalValue(value) {
  const folded = String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’‛`´]/g, "'")
    .replace(/[“”‟]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[\s"'(\[]+|[\s"')\].,;:!?]+$/g, "")
  return folded
}

/** The task a commitment fallback key hashes: words only, in order, folded. */
export function normaliseTask(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}
