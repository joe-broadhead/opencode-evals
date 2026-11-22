/**
 * The shapes and limits of Memory's job runner (DESIGN-MEMORY-JOBS §1.2, §4.2).
 *
 * A job is one current definition. Its **digest** is taken over the parts a run
 * must be held to — extract, transform, curate, outputs, grants and budgets —
 * so a run can say exactly what it ran (§1.2). J0 keeps one version: the
 * template's, hashed at create.
 */
import { sha256 } from "../ids.js"

export const JOBS_USER = "jobs"
export const JOB_AGENT = "jobs"

export const JOB_ID = /^job_[0-9A-HJKMNP-TV-Z]{26}$/
export const RUN_ID = /^run_[0-9A-HJKMNP-TV-Z]{26}$/
/** A page path's segment: lower case, digits and hyphens, as `records` paths are. */
export const SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/
export const PROJECT_PAGE = /^projects\/[a-z0-9][a-z0-9-]{0,63}$/

/** A run's lease: two heartbeats of a minute (DESIGN §4.2). */
export const LEASE_MS = 120_000
/** A `running` row older than twice the longest run is one a restart interrupted (§4.2). */
export const STALE_MS = 2 * 60 * 60 * 1000
/** Retries and backoff: 1 m, 5 m, 30 m, 2 h, then `failed` (§4.2). */
export const RETRY_MS = Object.freeze([60_000, 300_000, 1_800_000, 7_200_000])
/** Three failed runs in a row pause the job (§4.2). */
export const BREAKER_FAILURES = 3
/** The server's tick: one minute, for job due-times (§4.1). */
export const TICK_MS = 60_000
/** A host seen within this long is running: the console's own threshold (deploy/auth/console/jobs-area.mjs `HOST_ONLINE_MS`). */
export const HOST_ONLINE_MS = 10 * 60_000
/** A host unseen for this long is deleted (lane 0189). */
export const HOST_PRUNE_MS = 7 * 24 * 3_600_000
/** The code a host sends with `jobs.finish` when the run's connector is not on it (a plugin that has `connectors`). */
export const CONNECTOR_UNAVAILABLE = "connector_unavailable"
/** At most this many plugin ids in a host's `connectors`. */
export const MAX_CONNECTORS = 50

/**
 * The two messages today's plugin sends with `jobs.finish` when its host cannot
 * read the connector, word for word, with the job's own connector filled in:
 *
 * - `src/jobs/host.js:345`: `this host gives plugins no tools RPC, so a job cannot read its connector`
 * - `src/jobs/host.js:347`: `the host has no RPC method ${job.connector}.tools/events_list`
 *
 * A host built before `error_code` sends only these. Anything else, or the
 * same words for another connector, is an ordinary failure.
 */
export const connectorMissingMessages = (connector) => [
  "this host gives plugins no tools RPC, so a job cannot read its connector",
  `the host has no RPC method ${connector}.tools/events_list`,
]

/** Items a checkpoint may carry: one events_list page. */
export const MAX_PAGE_ITEMS = 500

const EVERY = /^(\d{1,4})(m|h)$/

/** "30m" or "2h" as milliseconds; at least 5 minutes (DESIGN §4.1). */
export function everyMs(text, fallback = 1_800_000) {
  const match = EVERY.exec(String(text ?? ""))
  if (!match) return fallback
  const ms = Number(match[1]) * (match[2] === "h" ? 3_600_000 : 60_000)
  return Math.max(5 * 60_000, ms)
}

/** The digest of a job version: the parts a run is held to. */
export function jobDigest({ extract, transform, curate, outputs, grants, budgets }) {
  const canonical = JSON.stringify([extract, transform, curate, outputs, grants, budgets], (key, value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return Object.fromEntries(Object.keys(value).sort().map((name) => [name, value[name]]))
    }
    return value
  })
  return sha256(canonical)
}

/** The page a job's block is owned on, from the template's `{{project}}`. */
export function pageOf(template, project) {
  const curate = template.curate?.[0]
  if (!curate || typeof curate.page !== "string") return null
  return curate.page.replaceAll("{{project}}", project)
}

/** The next due time after a run: a cadence on success, the retry ladder on failure. */
export function nextDue(nowMs, { every, failures = 0 }) {
  if (failures > 0) return new Date(nowMs + RETRY_MS[Math.min(failures, RETRY_MS.length) - 1]).toISOString()
  return new Date(nowMs + every).toISOString()
}

/** The `channel:<id>` a collected message names, from its labels. */
export function channelsOf(labels) {
  const out = []
  for (const label of Array.isArray(labels) ? labels : []) {
    const match = /^channel:([A-Za-z0-9]{1,40})$/.exec(String(label))
    if (match) out.push(match[1])
  }
  return out
}
