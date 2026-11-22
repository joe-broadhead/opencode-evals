/**
 * The claims layer's switch (S2, docs/design/memory-routines-v1.md §12).
 * `RECORDS_CLAIMS=on` opens it; anything else, including unset, leaves it off.
 * While off, every entry point answers without touching a space file, so the
 * daily's behaviour is exactly what it was.
 */
export const CLAIMS_ENV = "RECORDS_CLAIMS"
/** The design's own name for the same switch (review L). */
export const CLAIMS_V2_ENV = "RECORDS_ROUTINES_V2"

/** @param {Record<string, string | undefined>} [env] */
export function claimsEnabled(env = process.env) {
  const on = (name) =>
    String(env?.[name] ?? "off")
      .trim()
      .toLowerCase() === "on"
  return on(CLAIMS_ENV) || on(CLAIMS_V2_ENV)
}
