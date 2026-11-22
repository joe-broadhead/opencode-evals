/**
 * The engine's switch (S3a, docs/design/s3-engine-plan.md §1).
 *
 * `RECORDS_ENGINE` is `off` (the default), `ingest`, `shadow` or `on`, and it is
 * **not** `RECORDS_ROUTINES_V2`: in S2 that name is an alias of
 * `RECORDS_CLAIMS`, so turning the claims layer on would also start the engine.
 * With `off` the engine writes nothing at all — the columns exist and stay null,
 * no marker is made and no lease runs — so production is unchanged.
 *
 * `ingest` numbers events, hashes their content and assigns their lane with no
 * model call. `shadow` adds S3b's leases and its shadow sink. `on` is reserved
 * for S8; this build runs the `ingest` half of it and says so at start-up.
 */
export const ENGINE_ENV = "RECORDS_ENGINE"

/**
 * The shadow cohort (design §6; the plan's §1): the spaces the engine reads
 * while it is in `shadow`. Comma separated; empty means no space, so a cell that
 * turns shadow on without a list runs nothing.
 */
export const ENGINE_SPACES_ENV = "RECORDS_ENGINE_SPACES"

/** The four values, in the order they add work. */
export const ENGINE_MODES = Object.freeze(["off", "ingest", "shadow", "on"])

/**
 * The mode from the environment. A value outside the four is a startup refusal,
 * never a silent `off`: a typo must not leave a cell quietly unnumbered.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {"off" | "ingest" | "shadow" | "on"}
 */
export function engineMode(env = process.env) {
  const raw = String(env?.[ENGINE_ENV] ?? "off")
    .trim()
    .toLowerCase()
  if (!ENGINE_MODES.includes(raw)) throw new Error(`${ENGINE_ENV} is ${ENGINE_MODES.join(", ")}; got ${JSON.stringify(env?.[ENGINE_ENV])}`)
  return raw
}

/**
 * True when the engine does its ingest work: every mode but `off`. `ingest`
 * is the only mode S3a adds; `shadow` and `on` include it, because both read
 * what ingest numbered.
 */
export function engineOn(mode) {
  return ENGINE_MODES.includes(mode) && mode !== "off"
}

/**
 * The cohort, as a set of space ids.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {Set<string>}
 */
export function cohortOf(env = process.env) {
  return new Set(
    String(env?.[ENGINE_SPACES_ENV] ?? "")
      .split(",")
      .map((name) => name.trim())
      .filter((name) => /^[A-Za-z0-9_.-]{1,128}$/.test(name)),
  )
}

/**
 * True when the engine's leases run for this space: the mode is `shadow` and the
 * space is in the cohort. `off` and `ingest` lease nothing, and a space outside
 * the cohort is numbered but never read (design §6).
 */
export function shadowFor(spaceId, { mode, cohort }) {
  return mode === "shadow" && cohort instanceof Set && cohort.has(spaceId)
}
