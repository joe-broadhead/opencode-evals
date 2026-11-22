/**
 * The claims layout's build (S2 review, M6). A space that holds claims was
 * written by a build that knows the claims tables; a build that does not know
 * them cannot scrub them when a person is erased. So the writer records its
 * build in `meta`, and an opening build that finds claims without its own
 * marker refuses until an operator acknowledges the rollback.
 */
import { claimHandle } from "./db.js"
import { ClaimsError } from "./errors.js"

/** The claims layout this build writes. Bump it when the tables change shape. */
export const CLAIMS_BUILD = "claims@1"

/** The environment switch that acknowledges a rollback over a claims file. */
export const ROLLBACK_ACK = "RECORDS_CLAIMS_ROLLBACK_ACK"

/**
 * @param {any} handle a store handle, or a node:sqlite database
 * @param {{env?: Record<string, string | undefined>}} [options]
 * @returns {{checked: boolean, rows: number, build: string|null, acknowledged?: boolean}}
 */
export function checkClaimsBuild(handle, { env = process.env } = {}) {
  const db = handle && typeof handle.get === "function" ? handle : claimHandle(handle)
  const has = db.get("select 1 as present from sqlite_master where type = 'table' and name = 'claims'")
  if (!has) return { checked: false, rows: 0, build: null }
  // A matching marker is the common path: one meta read, and no count.
  const build = db.get("select value from meta where key = 'claims_build'")?.value ?? null
  if (build === CLAIMS_BUILD) return { checked: true, rows: null, build }
  const rows = Number(db.get("select count(*) as n from claims").n)
  if (rows === 0) return { checked: true, rows: 0, build }
  if (String(env?.[ROLLBACK_ACK] ?? "").trim().toLowerCase() === "on") {
    return { checked: true, rows, build, acknowledged: true }
  }
  throw new ClaimsError(
    "claims_build",
    `This space holds ${rows} claims written by ${build ?? "a build that recorded no claims marker"}, and this build writes ${CLAIMS_BUILD}. A build that does not know the claims tables cannot scrub them on erasure.`,
    `Set ${ROLLBACK_ACK}=on to acknowledge the rollback, or purge the claims tables first (records/src/claims/README.md).`,
  )
}
