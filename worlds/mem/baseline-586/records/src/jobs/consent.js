/**
 * A job's consent (DESIGN-MEMORY-JOBS §5.2, §5.4, §5.6): the bind-like flow,
 * for one job.
 *
 * 1. **jobs.request** — the person asks, in the console, to turn the job (or
 *    its draft) on. Nothing is read here.
 * 2. **jobs.probe** — the person's own job host reports which account the
 *    job's connector is signed in to, for that exact version and digest. Only
 *    the person who asked may answer; a probe on a stale draft is refused.
 * 3. **jobs.consent** — the person confirms, in a browser session of the
 *    console, the account, the scope and the grants. That is the act that
 *    records the consent and makes the version active (§5.6, `source.consent`
 *    with its `job.consent` counterpart).
 *
 * The consent stores the job's **limits** (§5.4). A later version is judged
 * against them by `classifyVersion`; only widening needs the person again.
 *
 * **P2 is dark in this build.** A host-signed grant (`jelly-act+jwt`, ADR
 * verified-caller-grants) is the second door §5.6 allows. No key file is
 * configured here and no verifier is deployed, so every grant is refused
 * (`grant_unavailable`) and the console session is the only door. The hook is
 * `verifyHostGrant`, and the test pins that a grant-bearing act is refused
 * rather than believed.
 */
import { RecordsError, conflict, forbidden, notFound } from "../errors.js"
import { errorText } from "../text.js"
import { classifyVersion, docOfJob, limitsOf } from "./versions.js"
import * as rows from "./rows.js"

const CONSOLE_NEXT = "The person opens Memory's console, Jobs, signed in in a browser, and confirms it there."

const parse = (text, fallback) => {
  try {
    return text === null || text === undefined ? fallback : JSON.parse(text)
  } catch {
    return fallback
  }
}

/** The refusal of an act only the person, in a browser session of the console, may take (§5.6 P1). */
export function sessionRequired(what) {
  return new RecordsError(403, "session_required", `${what} is the person's own act, in a browser, in Memory's console (Jobs), not with a key or an agent's token.`, CONSOLE_NEXT)
}

/**
 * P2, a verified host grant. **Dark:** no verifier or key file exists in this
 * build, so a grant is refused, never believed. The shape is the one §5.6
 * names (`{act, input, grant}`) so the verifier can be dropped in behind it
 * without changing a call site.
 */
export function verifyHostGrant(_handle, _input = {}) {
  return { ok: false, code: "grant_unavailable", message: "A host-signed grant is not verified by this build of Memory, so only the person, in a browser, can approve a job.", next: CONSOLE_NEXT }
}

/**
 * A version this consent does not cover: the widening list, or null when the
 * version is within the limits the person confirmed (or there is no consent).
 */
export function wideningOf(consentRow, doc) {
  if (!consentRow) return null
  const verdict = classifyVersion(parse(consentRow.limits, null), doc)
  return verdict.within ? null : verdict
}

/**
 * Whether a job may run, as far as its own consent is concerned. **It fails
 * closed:** a job with no consent row cannot be claimed, run, resumed or
 * activated, whatever its connector's binding says. The J0 path had no
 * consent row and ran on the binding alone; that is exactly the hole the
 * review found (a draft, archived and resumed, ran at version 0 with no
 * consent), so there is no such path any more.
 */
export function consentProblem(handle, job) {
  const consent = rows.consentRow(handle, job.id)
  if (!consent) {
    return {
      code: "job_consent_required",
      message: `Job ${job.id} has no consent, so it cannot run.`,
      next: "Confirm it in Memory's console, Jobs: the person confirms the account, the scope and the grants there.",
    }
  }
  if (consent.state !== "on") {
    // A consent's reason can be a source's own failure text, and an old row may hold it raw (0.11 review, Check 2).
    return { code: "job_consent_paused", message: `Job ${job.id} is not consented: ${consent.reason ? errorText(consent.reason, 200) : consent.state}.`, next: "Confirm the job again in Memory's console, Jobs." }
  }
  if (consent.digest === job.digest) return null
  const verdict = classifyVersion(parse(consent.limits, null), docOfJob(job))
  if (verdict.within) return null
  return {
    code: "job_widening",
    message: `Job ${job.id} changed beyond what the person confirmed: ${verdict.widening.slice(0, 3).join("; ")}.`,
    next: "Confirm the change in Memory's console, Jobs, before the job runs again.",
  }
}

// ---------------------------------------------------------------------------
// jobs.request / jobs.probe

/** Request the person's confirmation for a version of a job (nothing is read). */
export function requestConsent({ handle, actor, nowIso }, body, { job, version }) {
  const current = rows.draftRow(handle, job.id) ?? rows.activeVersionRow(handle, job.id)
  const asked = body?.version === undefined || body?.version === null ? current : rows.versionRow(handle, job.id, Number(body.version))
  if (!asked) throw notFound(`Job ${job.id} has no version to confirm.`, "Save a draft first, then ask to confirm it.")
  if (asked.state !== "draft" && asked.state !== "active") throw conflict("job_version_settled", `Version ${asked.version} of ${job.id} is ${asked.state}.`, "Ask to confirm the draft above it.")
  // A consent that is not on is not "already consented": a paused one has to
  // be asked for again, which is how the person turns it back on.
  const consent = rows.consentRow(handle, job.id)
  if (asked.state === "active" && consent?.state === "on" && consent.digest === asked.digest) {
    throw conflict("already_consented", `Version ${asked.version} of ${job.id} is already confirmed.`, "Nothing to do: change the job first if you want a new confirmation.")
  }
  rows.upsertRequest(handle, { job_id: job.id, version: asked.version, digest: asked.digest, requested_by: actor.user, requested_at: nowIso })
  return { request: rows.pubRequest(rows.requestRow(handle, job.id)) }
}

/**
 * The person's own host reports the account it read for the requested version.
 * Owner-only: the person who asked is the only caller whose answer counts.
 */
export function probeConsent({ handle, actor, nowIso }, body, { job, version }) {
  const request = rows.requestRow(handle, job.id)
  if (!request) throw notFound(`Nobody asked to confirm job ${job.id}.`, "Ask for it first in Memory's console, Jobs, then the host reports the account.")
  if (request.requested_by !== actor.user) throw forbidden("Only the person who asked to confirm this job can report the account for it.", "The person's own job host reports on their request.")
  if (!version || request.version !== version.version || request.digest !== version.digest) {
    throw conflict("job_probe_stale", `The request for job ${job.id} names version ${request.version}; this version is ${version?.version ?? "gone"}.`, "Ask to confirm the version that is on screen now.")
  }
  const owner = body?.owner && typeof body.owner.id === "string" && body.owner.id.trim() && body.owner.id.length <= 300 ? { id: body.owner.id, label: String(body.owner.label ?? body.owner.id).slice(0, 300) } : null
  if (body?.account !== undefined && body.account !== null && String(body.account) !== version.doc.account) {
    throw conflict("job_probe_account", `The host read ${String(body.account).slice(0, 60)} but the job names ${version.doc.account}.`, "Edit the job's account in Memory's console, or confirm the one it shows.")
  }
  // The source's own words, from whichever host sent them: redacted on the way
  // in as well as on the way out (round 2, S3).
  const note = body?.note === undefined || body.note === null ? null : errorText(String(body.note), 300)
  rows.reportRequest(handle, job.id, { state: owner ? "reported" : "failed", owner, note: note ?? (owner ? null : "the host could not read which account the connector is signed in to"), at: nowIso })
  return { request: rows.pubRequest(rows.requestRow(handle, job.id)) }
}

// ---------------------------------------------------------------------------
// jobs.consent

/**
 * The person's confirmation: the account their host reported, the scope, and
 * the grants, for one exact version and digest. It records the limits and
 * returns the row; the caller makes the version active in the same
 * transaction, so consent and activation cannot come apart.
 */
export function consentJob({ handle, actor, nowIso }, body, { job, version }) {
  if (actor.credential !== "session") throw sessionRequired("Confirming a job")
  if (body?.grant !== undefined) {
    const verified = verifyHostGrant(handle, { act: "source.consent", grant: body.grant })
    throw new RecordsError(403, verified.code, verified.message, verified.next)
  }
  if (!version) throw notFound(`Job ${job.id} has no version to confirm.`, "Save a draft first.")
  const request = rows.requestRow(handle, job.id)
  if (!request || request.state !== "reported" || !request.owner_id) {
    throw conflict("job_not_reported", `The person's host has not reported which account ${job.connector} is signed in to for this job.`, "Ask to confirm it in Memory's console, Jobs: the host reports the account, then confirm it.")
  }
  if (request.requested_by !== actor.user) throw forbidden("Only the person who asked to confirm this job can confirm it.", CONSOLE_NEXT)
  if (request.version !== version.version || request.digest !== version.digest) {
    throw conflict("job_probe_stale", `The reported account was read for version ${request.version}, and this is ${version.version}.`, "Reload the job in Memory's console and ask to confirm the version on screen.")
  }
  const reported = { id: request.owner_id, label: request.owner_label ?? request.owner_id }
  const seen = String(body?.owner_id ?? "")
  if (seen !== reported.id) {
    throw new RecordsError(403, "owner_mismatch", `${job.connector} is signed in as ${reported.label}: a consent confirms only the account the host reported.`, "Reload Jobs in Memory's console and confirm the account it shows.")
  }
  // The account's owner is part of what the person confirms, and it is the one
  // part of a version an author cannot know: record it on the version now, so
  // the definition that runs and the consent agree (the digest does not cover
  // it: versions.js `specDigest`).
  version.doc = { ...version.doc, owner: reported }
  rows.setVersionDoc(handle, job.id, version.version, version.doc)
  const consent = {
    job_id: job.id,
    version: version.version,
    digest: version.digest,
    connector: version.doc.connector,
    source: version.doc.source,
    account: version.doc.account,
    owner_id: reported.id,
    owner_label: reported.label,
    scope: version.doc.scope,
    kinds: version.doc.kinds,
    grants: version.doc.grants,
    limits: limitsOf(version.doc),
    consented_at: nowIso,
    consented_by: actor.user,
    updated: nowIso,
  }
  rows.upsertConsent(handle, consent)
  rows.deleteRequest(handle, job.id)
  return { consent: rows.pubConsent(rows.consentRow(handle, job.id)) }
}
