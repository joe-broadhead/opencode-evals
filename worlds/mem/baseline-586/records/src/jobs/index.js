/**
 * Memory Jobs, slice J0: the job runner on the records service
 * (DESIGN-MEMORY-JOBS §3, §4, §13 J0).
 *
 * **What runs here:** the schedule and the run ledger, the lease and its epoch
 * (§4.2), the checkpoint with cursor compare-and-set and the ingest refusals
 * (S2's `checkIngest`), the `render` curate stage that owns one lens block on
 * one page, and run history. The extract stage runs on a **job host**
 * (src/jobs/host.js in the plugin): it claims a run, reads `events_list` in a
 * session that holds exactly the job's grants, and checkpoints what it read.
 *
 * **One writer.** Every write is one transaction over the space's file, so a
 * checkpoint commits its items and its cursor together, and a stale host is
 * refused by the epoch rather than by good timing.
 *
 * **Leases.**
 * - `claim` leases the oldest queued run, or creates one for a job that is due,
 *   or re-leases a `running` row whose lease expired at `epoch + 1`.
 * - A `running` row with a live lease is not claimable: that is two hosts, one
 *   writer.
 * - A checkpoint or finish carries the epoch. Another epoch, or an expired
 *   lease, is `409 lease_lost` and stores nothing.
 * - A checkpoint renews the lease (it is the host's heartbeat), so a long run
 *   keeps it; a run older than twice the longest run is marked failed by the
 *   tick and its job re-queued (§4.2 stale running).
 *
 * **Curate is idempotent.** The block is rebuilt from every item the job has,
 * deduped by `(job, connector, account, external_id)`, so a re-run of the same
 * page changes nothing and writes nothing. A person's edit inside the block
 * stops the job writing it (§6.2) and is logged, never overwritten.
 *
 * **Personal only (J0).** A job is made and runs in a personal space; shared
 * jobs are J5. There are no model calls, no scripts and no shared writes.
 */
import { JOBS_USER, JOB_AGENT, LEASE_MS, STALE_MS, BREAKER_FAILURES, MAX_PAGE_ITEMS, TICK_MS, SLUG, everyMs, channelsOf, nextDue, pageOf, HOST_ONLINE_MS, HOST_PRUNE_MS, CONNECTOR_UNAVAILABLE, MAX_CONNECTORS, connectorMissingMessages } from "./model.js"
import { JOURNAL_PAGE, JOB_TEMPLATES, declaredTemplateRef, docFromDeclaredTemplate, templateOf } from "./templates.js"
import { lensHash, mergeLensBlock, pageTitle, renderLines, splitLensBlock, unedited, visibleText } from "./render.js"
import { acceptedItems, batchRefsOf, buildJobPrompt, entityProposals, extractStage, gateJobClaims, jobGateClient, outputsOf, personFor, planUnits, projectLinkProposal, proposalOf, qualityOf, staleness } from "./extract.js"
import { retireMeetingProposals, retireProposals, writeMeetingProposals, writeProposals } from "./proposals.js"
import { MEETING_TYPE, isLiveMeeting, meetingDayOf, meetingDigest, meetingText, notesWriter, proposeFromMeeting } from "./meetings.js"
import { createLlm, estimateTokens } from "../routines/llm.js"
import { createModelGuard } from "../model-guard.js"
import { batchUnits } from "../routines/extract.js"
import { HOLD_BACKOFF_HOURS } from "../routines/daily.js"
import { createTraitGate, traitBreakerOfCell } from "../routines/traits.js"

import { buildIndex, personFrom } from "../routines/passes.js"
import { localDay, safeTz } from "../routines/dates.js"
import { fold, quoteFound } from "../routines/guards.js"
import { docOfJob, diffOf, diffDigest, limitsOf, specDigest } from "./versions.js"
import * as jobConsent from "./consent.js"
import * as rows from "./rows.js"
import { normalizeEvent, sessionIdOf, FUTURE_EVENT_REASON, isFarFuture } from "../events-normalize.js"
import { errorText } from "../text.js"
import { JOBS_SCHEMA } from "./schema.js"
import { declaredReads, identityFor, jobGrants, templateById } from "../plugins/manifest.js"
import * as pluginConsent from "../plugins/consent.js"
import { requireRole } from "../access.js"
import { RecordsError, conflict, invalid, notFound } from "../errors.js"
import { eventId, ulid } from "../ids.js"

// A connector's account: the contract's `ACCOUNT_PATTERN` within Memory's cap of 128 (src/sources.js holds the same grammar).
const ACCOUNT = /^[^\s*?:\u0000-\u001f\u007f]{1,128}$/
const HOST_ID = /^[A-Za-z0-9_.:-]{1,100}$/
// A plugin id, as plugins.consent and the store read it (records/src/plugins/consent.js).
const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const MAX_REFUSALS = 50
const quiet = { debug() {}, info() {}, warn() {}, error() {} }

/** The actor Memory's job runner writes as: a system principal, never a space's owner. */
export function jobsActor(spaceId, extra = {}) {
  return { user: JOBS_USER, agent: JOB_AGENT, session: null, role: "owner", grants: [], space: spaceId, spaceKind: "personal", ...extra }
}

/**
 * @param {{store: any, now?: () => Date, log?: object, guard?: any, config?: {leaseMs?: number, staleMs?: number, tickMs?: number}}} input
 */
export function createJobs({ store, now = () => new Date(), log = quiet, config = {}, llm = null, guard = null }) {
  const leaseMs = Number.isFinite(config.leaseMs) ? config.leaseMs : LEASE_MS
  const staleMs = Number.isFinite(config.staleMs) ? config.staleMs : STALE_MS
  let timer = null
  let ticking = null

  // The extract engine (J4): **off unless a deployment turns it on**, because
  // the design gates it on its precision eval (§6.1, §13 J4). The model is the
  // routines' own client; the breaker is the routines' own shape.
  const extractMode = String(config.extract ?? "off").toLowerCase() === "on" ? "on" : "off"
  const extractBudget = Number.isFinite(config.extractBudgetTokens) ? config.extractBudgetTokens : 15_000
  const jobDailyTokens = Number.isFinite(config.jobDailyTokens) ? config.jobDailyTokens : 40_000
  const breakerFailures = Number.isFinite(config.breakerFailures) ? config.breakerFailures : 3
  const breakerCooldownMs = Number.isFinite(config.breakerCooldownMs) ? config.breakerCooldownMs : 3_600_000
  // A service-wide cap across every job of a space (J4 review, finding 7).
  const extractServiceTokens = Number.isFinite(config.extractServiceTokens) ? config.extractServiceTokens : 120_000
  // The quality loop (§6.3) and the staleness lint (§6.2).
  const qualityMinDecisions = Number.isFinite(config.qualityMinDecisions) ? config.qualityMinDecisions : 20
  const qualityMaxReject = Number.isFinite(config.qualityMaxReject) ? config.qualityMaxReject : 0.6
  const staleAfterDays = Number.isFinite(config.staleAfterDays) ? config.staleAfterDays : 30
  // Meeting pages (0.11, opencode-mem#58 item 2): **proposals only, and off by
  // default** (owner, round 10: on only after the held-out set passes). It is a
  // different switch from `extract`, which saves nothing directly and stays off.
  // It never writes a memory.
  const meetingMode = String(config.meetingProposals ?? "off").toLowerCase() === "on"
  const meetingRunTokens = Number.isFinite(config.meetingRunTokens) ? config.meetingRunTokens : 15_000
  // One tick's meeting work is bounded, so a space with many saved pages never
  // spends a whole tick on them (0.11 review, should-fix 3).
  const meetingPagesPerPass = Number.isFinite(config.meetingPagesPerPass) ? Math.max(1, config.meetingPagesPerPass) : 5
  // A part that keeps failing is capped, with a back-off, and then the page
  // needs attention: a page's own failures never reopen the space's shared
  // breaker, which would also stop its routines and jobs (0.11 review).
  const meetingPartAttempts = Number.isFinite(config.meetingPartAttempts) ? Math.max(1, config.meetingPartAttempts) : 3
  const meetingPartBackoffMs = Object.freeze([60_000, 300_000])
  /** The spaces whose meeting page was written since their last pass. */
  const dirtyMeetings = new Set()
  // The model breaker and the day's budget are **one per space, shared with the
  // routines** (0.11, records/src/model-guard.js): one space's failures never
  // silence another, and what the routines spent leaves the jobs less. The
  // service passes the same guard to both; a build with only jobs makes its own.
  const modelGuard =
    guard ??
    createModelGuard({ store, now, log, config: { limit: config.budgetTokens, breakerFailures: config.breakerFailures, breakerCooldownMs: config.breakerCooldownMs } })
  const rawLlm = llm ?? (config.llm ? createLlm({ ...config.llm, log }) : null)

  /** The store tells this runner which space a meeting page was written in (0.11). */
  store.setMeetingListener?.(({ spaceId: written }) => {
    if (written) dirtyMeetings.add(written)
  })
  // While the feature is off, a save leaves no mark: nothing waits, no space is
  // opened, and switching on later proposes only from saves made after it.
  store.setMeetingEnabled?.(meetingMode)

  const space = (spaceId) => store.forSpace(spaceId)
  const nowIso = () => now().toISOString()
  const nowMs = () => now().getTime()
  const iso = (ms) => new Date(ms).toISOString()

  /** Every job method runs with the space's role checks and the job runner's own actor. */
  const system = (spaceId, actor) => {
    const a = actor ?? jobsActor(spaceId)
    return { ...a, space: spaceId }
  }

  // -------------------------------------------------------------------------
  // Definitions

  function template() {
    return { templates: JOB_TEMPLATES }
  }

  /**
   * A job's connectors are confirmed bindings (DESIGN §5.2, §5.3): the person's
   * browser-session consent for `(source, account)`, on the declaration now on
   * disk, and the job's grants, scope and kinds **inside** consent ∩ disk.
   * Anything wider is a refusal, never a silent widening: without this, a job's
   * session would hold grants the person never saw.
   */
  function bindingProblem(handle, { connector, source, account, owner, scope, grants: wanted, kinds: wantedKinds }) {
    const consent = handle.get("select * from plugin_consents where source = ? and account = ?", source, account)
    if (!consent) return { code: "job_consent_required", message: `No one has confirmed ${source} (${account}) for this space, so a job cannot read it.`, next: "Turn the source on in Memory's console: your collector reports the account, then you confirm it in a browser session." }
    // The pause's reason is a source's failure text, and a row written before 0.11's fix may hold it raw:
    // this sentence is stored in `jobs.reason` and shown by the console (0.11 review, Check 2).
    if (consent.state !== "on") return { code: "job_consent_paused", message: `${source} (${account}) is ${consent.state}: ${consent.reason ? errorText(consent.reason, 200) : "no reason given"}.`, next: "Turn it back on in Memory's console, then run the job again." }
    if (consent.consented_via !== "session") return { code: "job_consent_session", message: `${source} (${account}) was not confirmed in a browser session, so nothing can be bound to it.`, next: "Confirm it again in Memory's console in a browser." }
    if (consent.plugin_id !== connector) return { code: "job_consent_plugin", message: `${source} (${account}) is confirmed for ${consent.plugin_id}, not ${connector}.`, next: "Confirm the plugin's own source, or make the job for the plugin that was confirmed." }
    if (!owner?.id) return { code: "job_owner", message: `${source} (${account}) was confirmed for an account nobody has named, so nothing can read it.`, next: "Confirm the account in Memory's console, Sources, and confirm the job's own account in Jobs." }
    if (consent.owner_id !== owner.id) return { code: "job_owner", message: `${source} (${account}) is confirmed for ${consent.owner_label ?? consent.owner_id}, not ${owner?.label ?? owner?.id}.`, next: "Send the owner events_list reports, or confirm the account the job is for." }
    const plugin = handle.get("select * from plugins where plugin_id = ?", consent.plugin_id)
    const live = plugin?.manifest_json ? parseJson(plugin.manifest_json, null)?.sources?.find?.((entry) => entry.id === source) : null
    if (!plugin || !live) return { code: "job_plugin_missing", message: `${consent.plugin_id} is not installed on the machine that last reported, so its declaration cannot be read.`, next: "Install it there, let Memory see it, and run the job again." }
    if (plugin.digest !== consent.digest) return { code: "job_plugin_changed", message: `${consent.plugin_id}'s declaration changed since you confirmed it.`, next: "Review the change in Memory's console and confirm it again before a job reads it." }
    // §9.1 D: a v2 job's grants come from the declaration the person confirmed —
    // its digest pins it — so the allowed set is what that declaration permits
    // for this source and account: the source's grants, every declared read's,
    // and the identity's. A v1 declaration keeps the source-list intersection.
    const manifest = parseJson(plugin.manifest_json, null)
    const allowed = manifest?.connector
      ? new Set(jobGrants(manifest, { source, account, steps: [{ use: "events_list" }, ...declaredReads(manifest).map((read) => ({ call: read.method }))] }).map(grantKey))
      : intersectGrants(parseJson(consent.snapshot_json, null)?.source?.grants, live.grants)
    const outside = (Array.isArray(wanted) ? wanted : []).filter((grant) => !allowed.has(grantKey(grant)))
    if (outside.length) return { code: "job_grants_widened", message: `The job reads ${outside.map((grant) => grant.action).join(", ")}, which ${consent.plugin_id} no longer declares to this person.`, next: "Update the plugin, or confirm the declaration the plugin now makes, before the job reads anything." }
    const confirmed = parseJson(consent.scope_json, {})
    for (const [key, ids] of Object.entries(scope ?? {})) {
      if (!allowedScope(ids, confirmed?.[key])) return { code: "job_scope_widened", message: `The job collects ${key} ${ids.slice(0, 3).join(", ")}, which the person did not confirm.`, next: "Confirm those ids for the source in Memory's console, or make the job for the ones you confirmed." }
    }
    const kinds = parseJson(consent.snapshot_json, null)?.source?.kinds ?? []
    const unknown = (Array.isArray(wantedKinds) ? wantedKinds : []).filter((kind) => !kinds.includes(kind))
    if (unknown.length) return { code: "job_kinds_widened", message: `The job collects ${unknown.join(", ")}, which the person did not confirm for ${source}.`, next: "Confirm the source again with those kinds, or make a job for the kinds it collects." }
    return null
  }

  /** The same checks, for a job already made: its own row is the specification. */
  function jobSpec(job) {
    return {
      connector: job.connector,
      source: job.source,
      account: job.account,
      owner: { id: job.owner_id, label: job.owner_label },
      scope: parseJson(job.scope, {}),
      grants: parseJson(job.grants, []),
      kinds: parseJson(job.kinds, []),
    }
  }

  /**
   * The checks are made again on every claim and every write (review follow-up
   * 2): a consent narrowed after the job was made must stop the job, not leave it
   * reading with grants the person no longer confirmed. A problem pauses it, with
   * the reason, and the caller refuses the write.
   */
  function pause(spaceId, a, job, problem, runId = null) {
    const at = nowIso()
    return jobTx(spaceId, a, (handle) => {
      rows.setJobStatus(handle, job.id, "paused", problem.message, at)
      if (runId) rows.log(handle, runId, at, "error", "job.paused", problem.message)
    })
  }

  // A refusal that also means "this job must not read again until the person
  // looks": the binding no longer holds, or the source restarted its window
  // twice in one day (§9.3). Each pauses the job with the reason.
  const BINDING_CODES = new Set(["job_consent_required", "job_consent_paused", "job_consent_session", "job_consent_plugin", "job_owner", "job_plugin_missing", "job_plugin_changed", "job_grants_widened", "job_scope_widened", "job_kinds_widened", "job_widening", "job_resync_limit"])

  /**
   * Everything that must hold for a job to run, in one place: the connector's
   * confirmed binding (J0) and the job's own consent (J1). A job made before
   * J1 has no consent row, and the binding check is then the whole gate.
   */
  function jobProblem(handle, job) {
    return bindingProblem(handle, jobSpec(job)) ?? jobConsent.consentProblem(handle, job)
  }

  /**
   * A write that is refused because the binding no longer holds also pauses the
   * job. The refusal rolls its own transaction back, so the pause is its own.
   */
  async function withPause(spaceId, a, runId, fn) {
    try {
      return await fn()
    } catch (error) {
      if (error?.code && BINDING_CODES.has(error.code) && typeof runId === "string") {
        const job = await readHandle(spaceId, a, (handle) => {
          const run = rows.runRow(handle, runId)
          return run ? rows.jobRow(handle, run.job_id) : null
        })
        // §9.3: a binding that restarted its window twice in one day is paused
        // itself, so every job on it stops with the same reason, not only this
        // one run's job.
        if (job && error.binding) {
          await jobTx(spaceId, a, (handle) => {
            pluginConsent.pauseBinding(handle, { pluginId: error.binding.pluginId, source: error.binding.source, account: error.binding.account, reason: error.message, at: nowIso() })
          }).catch(() => null)
        }
        if (job) await pause(spaceId, a, job, { message: error.message }, runId)
        if (error.binding) {
          // And every other active job on that binding, so none of them reads on.
          const others = await readHandle(spaceId, a, (handle) => rows.jobRows(handle).filter((row) => row.status === "active" && row.source === error.binding.source && row.account === error.binding.account))
          for (const other of others) await pause(spaceId, a, other, { message: error.message })
        }
      }
      throw error
    }
  }

  function checkBinding(handle, spec) {
    const problem = bindingProblem(handle, spec)
    if (problem) throw conflict(problem.code, problem.message, problem.next)
  }

  /** The exact page a version writes, from a `projects/<slug>` request. */
  function pageFor(template, project) {
    if (typeof project !== "string" || !SLUG.test(project)) {
      throw invalid("invalid_project", "project must be a page slug: lower case letters, digits and hyphens.", 'Send project as a name: "harbour" for the page projects/harbour.')
    }
    return pageOf(template, project)
  }

  function accountFor(value) {
    if (typeof value !== "string" || !ACCOUNT.test(value)) {
      throw invalid("invalid_account", "account must name the connector's account.", 'Send account as the account the person confirmed, for example "T0123".')
    }
    return value
  }

  /** The owner a job's connector answers for: `{ id, label }`, or null until the person's host reports it. */
  function ownerFor(value) {
    if (value === undefined || value === null) return null
    if (typeof value !== "object" || typeof value.id !== "string" || !value.id.trim() || value.id.length > 300) {
      throw invalid("invalid_owner", "owner must name the account's owner.", 'Send owner as the object events_list answers: {id: "slack:U…", label: "…"}.')
    }
    return { id: value.id.slice(0, 300), label: typeof value.label === "string" ? value.label.slice(0, 300) : null }
  }

  const plainScope = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {})

  /** The declaration a connector's install last reported, or null (§9.2). */
  function declarationOf(handle, connector) {
    const row = handle.get("select manifest_json from plugins where plugin_id = ?", connector)
    return row?.manifest_json ? parseJson(row.manifest_json, null) : null
  }

  /**
   * The doc for a job made from a template: the fixed one (J0), or the one the
   * connector ships in its declaration (§9.4). Both are data; neither carries a
   * grant of its own, and a declared one's grants are §9.1 D's set.
   */
  async function docForTemplate(spaceId, a, body) {
    const ref = declaredTemplateRef(body?.template)
    if (!ref) {
      const fixed = templateOf(body?.template)
      if (!fixed) throw invalid("invalid_template", `"${String(body?.template ?? "")}" is not a job template.`, `Send template as one of: ${JOB_TEMPLATES.map((entry) => entry.id).join(", ")}, or "<plugin id>/<template id>".`)
      return docFromTemplate(fixed, body)
    }
    const manifest = await readHandle(spaceId, a, (handle) => declarationOf(handle, ref.connector))
    if (!manifest) throw invalid("invalid_template", `${ref.connector} is not installed on the machine that last reported, so its templates cannot be read.`, "Install it there, let Memory see it, then make the job.")
    const template = templateById(manifest, ref.template)
    if (!template) {
      throw invalid("invalid_template", `"${ref.template}" is not a template ${ref.connector} ships.`, `Send template as one of: ${(manifest.templates ?? []).map((entry) => `${ref.connector}/${entry.id}`).join(", ") || "(none)"}.`)
    }
    return declaredDoc(ref.connector, manifest, template, body)
  }

  /** A declared template's doc, with the page its render stage needs (§9.4). */
  function declaredDoc(connector, manifest, template, body) {
    const stages = template.curate.stages
    const render = stages.find((stage) => stage.engine === "render")
    // A render stage that writes a section owns the job's own page, the page the
    // person chose; a journal stage writes the day's journal, so no project is
    // asked for. A template with no render stage anchors on the chosen page too,
    // or on the job's own page named after it.
    const chosen = body.project !== undefined && body.project !== null ? `projects/${pageFor({ curate: [{ page: "projects/{{project}}" }] }, body.project).split("/").pop()}` : null
    const page = render?.into === "journal" ? null : chosen ?? `projects/${template.id}`
    const doc = docFromDeclaredTemplate({
      connector,
      manifest,
      template,
      account: accountFor(body.account),
      owner: ownerFor(body.owner),
      scope: plainScope(body.scope),
      page,
      every: template.trigger?.schedule?.every ?? (manifest.sources ?? []).find((entry) => entry.id === template.extract.steps[0].source)?.cadence?.everyMinutes * 60_000,
    })
    doc.page = doc.page ?? page ?? JOURNAL_PAGE
    return doc
  }

  function docFromTemplate(template, body) {
    const project = pageFor(template, body.project)
    return {
      name: template.name,
      template: template.id,
      connector: template.connector,
      source: template.source,
      account: accountFor(body.account),
      owner: ownerFor(body.owner),
      scope: plainScope(body.scope),
      kinds: [...template.kinds],
      grants: [...template.grants],
      page: project,
      stage: template.curate[0].stage,
      every_ms: everyMs(body.every ?? template.every),
      extract: template.extract,
      transform: template.transform,
      curate: template.curate,
      outputs: [],
      budgets: template.budgets,
    }
  }

  /**
   * A version's doc for an edit (§5.5): the parts a person may change, over the
   * version they are changing. Everything else — the connector, the account,
   * the kinds, the budgets — is what the job was consented for, so a change
   * must arrive as a widening and be judged by `classifyVersion`.
   */
  function docFromEdit(base, body) {
    const doc = structuredClone(base)
    if (body.scope !== undefined) doc.scope = plainScope(body.scope)
    if (body.every !== undefined) doc.every_ms = everyMs(body.every, base.every_ms)
    if (body.account !== undefined) doc.account = accountFor(body.account)
    if (body.project !== undefined) doc.page = `projects/${pageFor({ curate: [{ page: "projects/{{project}}" }] }, body.project).split("/").pop()}`
    if (body.max_lines !== undefined) {
      const max = Math.max(1, Math.min(500, Number(body.max_lines) || 0))
      doc.curate = (Array.isArray(doc.curate) ? doc.curate : []).map((stage) => ({ ...stage, maxLines: max }))
    }
    doc.digest = specDigest(doc)
    return doc
  }

  async function create(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Making a job needs the space's owner")
    // Defence in depth behind the gateway's SESSION_METHODS: making a job that
    // runs is the person's act at a browser, so records refuses a bearer too.
    if (a.credential !== "session") throw jobConsent.sessionRequired("Making a job")
    if (a.spaceKind !== "personal") {
      throw new RecordsError(403, "job_personal_only", "Jobs are made in a personal space; shared jobs are not part of this build.", "Make the job in your own space, or ask an operator.")
    }
    const doc = await docForTemplate(spaceId, a, body)
    const at = nowIso()
    // The account's owner is the one the person's confirmed binding records,
    // never one the caller names: the body's owner, if given, must agree.
    const bound = await readHandle(spaceId, a, (handle) => handle.get("select owner_id, owner_label from plugin_consents where source = ? and account = ?", doc.source, doc.account))
    if (bound?.owner_id) {
      // A caller never names the account's owner: the person's own binding did.
      // A different one is refused by name, not quietly replaced.
      if (doc.owner?.id && doc.owner.id !== bound.owner_id) {
        throw conflict("job_owner", `${doc.source} (${doc.account}) is confirmed for ${bound.owner_label ?? bound.owner_id}, not ${doc.owner.label ?? doc.owner.id}.`, "Send owner as the account the person confirmed, or leave it out and the binding's owner is used.")
      }
      doc.owner = { id: bound.owner_id, label: bound.owner_label ?? bound.owner_id }
    }
    const job = {
      id: `job_${ulid(nowMs())}`,
      name: doc.name,
      status: "active",
      version: 1,
      template: doc.template,
      connector: doc.connector,
      source: doc.source,
      account: doc.account,
      owner: doc.owner,
      scope: doc.scope,
      kinds: doc.kinds,
      grants: doc.grants,
      page: doc.page,
      stage: doc.stage,
      digest: specDigest(doc),
      every_ms: doc.every_ms,
      extract: doc.extract,
      transform: doc.transform,
      curate: doc.curate,
      outputs: doc.outputs,
      budgets: doc.budgets,
      next_due: at,
      created: at,
      updated: at,
    }
    await jobTx(spaceId, a, (handle) => {
      // §5.2: the job's connector is a **confirmed binding**, so the job can
      // only be what the person confirmed in a browser session.
      checkBinding(handle, { connector: doc.connector, source: doc.source, account: doc.account, owner: doc.owner, scope: doc.scope, grants: doc.grants, kinds: doc.kinds })
      rows.insertJob(handle, job)
      rows.insertVersion(handle, { job_id: job.id, version: 1, digest: job.digest, state: "active", origin: a.credential === "session" ? "person" : "agent", base: 0, doc, diff: diffOf(null, doc), diff_digest: diffDigest(diffOf(null, doc)), created: at, created_by: a.user })
      // The consent that turns it on: the person is at a browser, and the
      // account is the one their own binding confirmed (checked just above).
      rows.upsertConsent(handle, { job_id: job.id, version: 1, digest: job.digest, connector: doc.connector, source: doc.source, account: doc.account, owner_id: doc.owner.id, owner_label: doc.owner.label, scope: doc.scope, kinds: doc.kinds, grants: doc.grants, limits: limitsOf(doc), consented_at: at, consented_by: a.user, updated: at })
    })
    log?.info?.({ event: "memory.job.create", job: job.id, template: job.template })
    return jobView(spaceId, a, job.id)
  }

  /**
   * Draft a job, or a new version of one (§5.5). **An agent's draft never
   * runs:** a new job is `draft` and has no claimable row, and an edit is a
   * version above the active one, which runs only when the person activates it
   * in a browser. The draft carries what changed, so the console can show it.
   */
  async function draft(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Drafting a job needs the space's owner")
    if (a.spaceKind !== "personal") {
      throw new RecordsError(403, "job_personal_only", "Jobs are made in a personal space; shared jobs are not part of this build.", "Make the job in your own space, or ask an operator.")
    }
    const origin = a.credential === "session" && a.principal !== "agent" ? "person" : "agent"
    const at = nowIso()
    const jobId = typeof body?.job_id === "string" && body.job_id ? body.job_id : null
    const id = jobId ?? `job_${ulid(nowMs())}`
    // A new job's doc comes from its template, which may be the connector's own:
    // that read happens before the transaction, so the transaction stays sync.
    const fresh = jobId ? null : await docForTemplate(spaceId, a, body ?? {})
    const made = await jobTx(spaceId, a, (handle) => {
      const current = jobId ? rows.jobRow(handle, jobId) : null
      if (jobId && !current) throw notFound(`No job ${jobId} in this space.`, "List the jobs first: mem_spaces jobs list.")
      const active = current ? rows.activeVersionRow(handle, current.id) : null
      const base = current ? (active?.doc ? JSON.parse(active.doc) : docOfJob(current)) : null
      const doc = current ? docFromEdit(base, body ?? {}) : fresh
      // One draft at a time: a newer one replaces it, and the diff is always
      // against the version that runs, so what the person approves is what
      // would change.
      const previous = rows.draftRow(handle, id)
      const nextVersion = Math.max(0, ...rows.versionRows(handle, id).map((row) => Number(row.version))) + 1
      if (previous) rows.dropVersion(handle, id, previous.version)
      const diff = diffOf(base, doc)
      if (!current) {
        rows.insertJobDraft(handle, { ...doc, id, status: "draft", version: 0, digest: specDigest(doc), next_due: null, created: at, updated: at })
      }
      rows.insertVersion(handle, { job_id: id, version: current ? nextVersion : 1, digest: specDigest(doc), state: "draft", origin, base: current ? current.version : 0, doc, diff, diff_digest: diffDigest(diff), created: at, created_by: a.user })
      return { id, version: current ? nextVersion : 1, diff }
    })
    log?.info?.({ event: "memory.job.draft", job: made.id, version: made.version, origin })
    return jobView(spaceId, a, made.id)
  }

  async function jobView(spaceId, a, jobId) {
    const view = await readHandle(spaceId, a, (handle) => {
      const row = rows.jobRow(handle, jobId)
      if (!row) return null
      // What the host needs to read this source the way its declaration says
      // (§9.2, §9.1 C): the owner-only call's input, and the scope inputs that
      // pin each declared read. Nothing collected is here.
      const manifest = declarationOf(handle, row.connector)
      const identity = manifest ? identityFor(manifest, row.source) : null
      const reads = manifest
        ? declaredReads(manifest).map((read) => ({ method: read.method, scopeInputs: read.scopeInputs ?? {}, ...(read.cursor ? { cursor: read.cursor } : {}), ...(read.kinds ? { kinds: read.kinds } : {}) }))
        : []
      return {
        job: rows.pubJob(row),
        draft: rows.pubVersion(rows.draftRow(handle, jobId)),
        request: rows.pubRequest(rows.requestRow(handle, jobId)),
        consent: rows.pubConsent(rows.consentRow(handle, jobId)),
        identity: identity ? { input: identity.input ?? {}, account: identity.account, owner: identity.owner } : null,
        reads,
      }
    })
    if (!view) throw notFound(`No job ${jobId} in this space.`, "List the jobs first.")
    return view
  }

  /** Every version of a job, newest first, with its diff. */
  async function versions(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "viewer", "Reading a job's versions needs a role in this space")
    const id = typeof body?.job_id === "string" ? body.job_id : null
    if (!id) throw invalid("invalid_job", "versions needs job_id.", "List the jobs first; each answer names its id.")
    return { versions: await readHandle(spaceId, a, (handle) => rows.versionRows(handle, id).map(rows.pubVersion)) }
  }

  const classifyAgainst = (consent, doc) => jobConsent.wideningOf(consent, doc)

  /** One version's diff, and what it would widen against the recorded consent. */
  async function diff(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "viewer", "Reading a job's diff needs a role in this space")
    const id = typeof body?.job_id === "string" ? body.job_id : null
    if (!id) throw invalid("invalid_job", "diff needs job_id.", "List the jobs first; each answer names its id.")
    return readHandle(spaceId, a, (handle) => {
      const row = Number.isInteger(Number(body?.version)) && body.version ? rows.versionRow(handle, id, Number(body.version)) : rows.draftRow(handle, id)
      if (!row) throw notFound(`Job ${id} has no such version.`, "Read the versions first.")
      const consent = rows.consentRow(handle, id)
      const verdict = consent ? classifyAgainst(consent, JSON.parse(row.doc)) : null
      return { version: rows.pubVersion(row), widening: verdict && !verdict.within ? verdict.widening : [] }
    })
  }

  const readHandle = (spaceId, a, fn) => space(spaceId).jobRead(a, fn)

  // -------------------------------------------------------------------------
  // The scheduler's index (0.11)

  /**
   * Which spaces have work *now*, so a tick opens only those. Every job write
   * goes through `jobTx`, which recomputes the space's entry in the same call,
   * so a job made, changed, run or finished updates it; the first tick after a
   * restart rebuilds the whole index with one scan. The entry is three numbers
   * (a due time, a stale time, a count), never a job's own text.
   */
  const schedule = new Map()
  let scheduleBuilt = false
  let building = null

  /** The space's entry, read from the handle the transaction already holds. */
  const workOf = (handle) => rows.workOf(handle, staleMs)

  /** One transaction over the job tables; the space's index entry follows it. */
  function jobTx(spaceId, a, fn) {
    return space(spaceId).jobTransaction(a, (handle) => {
      const answer = fn(handle)
      schedule.set(spaceId, workOf(handle))
      return answer
    })
  }

  /**
   * The scan a restart pays once: every space with a file, read once. It only
   * **fills in** entries, never removes or overwrites one: a job written while
   * the scan runs (`jobTx`) has already set its space's entry, and that entry is
   * newer than the scan's read. Removing a gone space is `workSpaces`' job.
   */
  function buildSchedule() {
    if (scheduleBuilt) return null
    if (!building)
      building = (async () => {
        const read = new Map()
        for (const spaceId of store.spaceIds()) {
          try {
            read.set(spaceId, await readHandle(spaceId, jobsActor(spaceId), workOf))
          } catch {
            // A space this process cannot read is not work: the next scan tries it again.
          }
        }
        for (const [spaceId, entry] of read) if (!schedule.has(spaceId)) schedule.set(spaceId, entry)
        scheduleBuilt = true
      })().finally(() => {
        building = null
      })
    return building
  }

  /**
   * The spaces a tick must open: a job due, a running run that may be stale, a
   * run to curate. A space the index has never seen — installed after the
   * startup scan, or while it ran — is read once here, so a new space is never
   * invisible; the index costs no more than the files that are new to it.
   */
  async function workSpaces() {
    if (!scheduleBuilt) await buildSchedule()
    const present = new Set(store.spaceIds())
    for (const spaceId of present) {
      if (schedule.has(spaceId)) continue
      try {
        schedule.set(spaceId, await readHandle(spaceId, jobsActor(spaceId), workOf))
      } catch {
        // Not readable now: the next tick tries it again.
      }
    }
    for (const spaceId of [...schedule.keys()]) if (!present.has(spaceId)) schedule.delete(spaceId)
    const at = nowMs()
    return [...schedule.entries()]
      .filter(([, entry]) => entry.due <= at || entry.staleAt <= at || entry.uncurated > 0 || entry.meetings > 0)
      .map(([spaceId]) => spaceId)
      .sort()
  }

  async function list(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "viewer", "Listing jobs needs a role in this space")
    const at = nowMs()
    const jobs = await readHandle(spaceId, a, (handle) => {
      const hosts = rows.hostRows(handle)
      return rows.jobRows(handle).map((row) => ({ ...rows.pubJob(row), draft: rows.pubVersion(rows.draftRow(handle, row.id)), request: rows.pubRequest(rows.requestRow(handle, row.id)), consent: rows.pubConsent(rows.consentRow(handle, row.id)), waiting: waitingOf(handle, row, hosts, at) }))
    })
    return { jobs }
  }

  /**
   * Why a job that should run does not: it is due (or its run waits, or its
   * lease is dead) and no host seen in the last 10 minutes may serve its
   * connector. `null` otherwise. The job is not paused and nothing moves: this
   * only says why. A fresh legacy host that was not marked incapable counts as
   * possibly able, because it has not said what it has (lane 0189).
   *
   * The 24-hour Inbox item CLAIMS.md §3.6 asks for is not raised: records has
   * no way to raise an Inbox item of its own (`inbox.list` and `inbox.decide`
   * read the review proposals that routines write, and a reminder to open an
   * agent is not a proposal about a memory).
   */
  function waitingOf(handle, job, hosts, at) {
    if (job.status !== "active") return null
    const stamp = iso(at)
    const open = rows.openRunForJob(handle, job.id)
    const due = open ? open.status === "queued" || !open.lease_expires || open.lease_expires <= stamp : job.next_due === null || job.next_due <= stamp
    if (!due) return null
    const capable = hosts.some((host) => {
      const seen = Date.parse(host.last_seen ?? "")
      if (!Number.isFinite(seen) || at - seen >= HOST_ONLINE_MS) return false
      const allow = rows.abilityOf(host)
      return allow === null || allow(job.connector)
    })
    return capable ? null : `no running agent has ${job.connector}`
  }

  async function get(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "viewer", "Reading a job needs a role in this space")
    const id = typeof body?.job_id === "string" ? body.job_id : typeof body?.id === "string" ? body.id : null
    const chosen = await readHandle(spaceId, a, (handle) => {
      if (id) return rows.jobRow(handle, id)
      const all = rows.jobRows(handle)
      return all.length === 1 ? all[0] : null
    })
    if (!chosen) throw notFound(id ? `No job ${id} in this space.` : "This space has no single job to name.", "List the jobs first.")
    return { ...(await jobView(spaceId, a, chosen.id)), runs: await runs(spaceId, { job_id: chosen.id, limit: 5 }, actor) }
  }

  async function runs(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "viewer", "Reading a job's runs needs a role in this space")
    const limit = Math.min(200, Math.max(1, Number(body?.limit) || 20))
    const jobId = typeof body?.job_id === "string" ? body.job_id : undefined
    return { runs: await readHandle(spaceId, a, (handle) => rows.runRows(handle, jobId, limit).map(rows.pubRun)) }
  }

  async function logs(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "viewer", "Reading a job's log needs a role in this space")
    let runId = typeof body?.run_id === "string" ? body.run_id : null
    return {
      logs: await readHandle(spaceId, a, (handle) => {
        if (!runId) runId = rows.runRows(handle, typeof body?.job_id === "string" ? body.job_id : undefined, 1)[0]?.id ?? null
        return runId ? rows.logRows(handle, runId) : []
      }),
    }
  }

  async function items(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "viewer", "Reading a job's items needs a role in this space")
    const jobId = typeof body?.job_id === "string" ? body.job_id : null
    return {
      items: await readHandle(spaceId, a, (handle) => {
        const job = jobId ? rows.jobRow(handle, jobId) : rows.jobRows(handle)[0]
        return job ? rows.itemRows(handle, job.id) : []
      }),
    }
  }

  async function hosts(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "viewer", "Reading the hosts needs a role in this space")
    return { hosts: await readHandle(spaceId, a, (handle) => rows.hostRows(handle)) }
  }

  /** A host says it is alive and what it can serve (§3.2). It grants nothing. */
  async function report(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "editor", "Reporting a job host needs the editor role in this space")
    if (typeof body?.host_id !== "string" || !HOST_ID.test(body.host_id)) throw invalid("invalid_host", "host_id must be a short stable id.", "Send the host's own id: letters, digits, dots, colons, hyphens or underscores.")
    const kind = body.kind === "team" ? "team" : "personal"
    const connectors = connectorsOf(body.connectors)
    const host = { host_id: body.host_id, kind, user: typeof body.user === "string" ? body.user.slice(0, 200) : null, plugins: Array.isArray(body.plugins) ? body.plugins.slice(0, 50) : [], bindings: Array.isArray(body.bindings) ? body.bindings.slice(0, 50) : [], ...(connectors === null ? {} : { connectors }) }
    return jobTx(spaceId, a, (handle) => {
      const at = nowIso()
      rows.upsertHost(handle, host, at)
      // A host unseen for 7 days is gone (lane 0189): the table is read by every
      // claim, and only an erasure removed a row before.
      rows.pruneHosts(handle, iso(nowMs() - HOST_PRUNE_MS))
      // The two optional hints (POLLING §5 cut 2): a host that predates them
      // reads only `host`, and they add nothing it must understand. They are
      // this host's own: only the connectors it may serve.
      return { host: { ...host, last_seen: at }, ...hints(handle, at, host.host_id) }
    })
  }

  /**
   * A host's `connectors`: the plugin ids active in its own process. Absent (or
   * null) means the host did not say, which is a legacy host and is stored as
   * null. A list is exact, even an empty one, so a bad one is refused rather
   * than cut: a silently shortened list would be a wrong exact one.
   */
  function connectorsOf(value) {
    if (value === undefined || value === null) return null
    if (!Array.isArray(value) || value.length > MAX_CONNECTORS || value.some((id) => typeof id !== "string" || !PLUGIN_ID.test(id))) {
      throw invalid("invalid_connectors", `connectors must be a list of at most ${MAX_CONNECTORS} plugin ids, such as ["slack.workspace"].`, "Send the ids of the plugins active in the host's own process, or leave the field out if the host cannot tell.")
    }
    return [...new Set(value)]
  }

  /**
   * The scheduling hints a host may use, or ignore: when a run is next claimable, and whether a probe waits (POLLING §5 cut 2).
   * For a host that listed its connectors, or failed with "not here", they cover only what it may serve (lane 0189):
   * without that, a host with no matching job sees a past `next_due_at` and asks again every 30 s.
   */
  function hints(handle, at = nowIso(), hostId = null) {
    const allow = hostId === null ? null : rows.abilityOf(rows.hostRow(handle, hostId))
    return { next_due_at: rows.nextClaimable(handle, at, allow), probe_pending: rows.probePending(handle, allow) }
  }

  // -------------------------------------------------------------------------
  // Consent, activation and the lifecycle (J1, §5.4, §5.5, §5.6)

  /** The person's own act: a browser session of the console. A P2 grant is refused while P2 is dark. */
  function personOnly(a, what, body) {
    if (a.credential !== "session") throw jobConsent.sessionRequired(what)
    if (body?.grant !== undefined) {
      const verified = jobConsent.verifyHostGrant(null, { act: what, grant: body.grant })
      throw new RecordsError(403, verified.code, verified.message, verified.next)
    }
  }

  const jobAndVersion = (handle, body, { needDraft = true } = {}) => {
    const id = typeof body?.job_id === "string" ? body.job_id : typeof body?.id === "string" ? body.id : null
    if (!id) throw invalid("invalid_job", "This needs job_id.", "List the jobs first: mem_spaces jobs list.")
    const job = rows.jobRow(handle, id)
    if (!job) throw notFound(`No job ${id} in this space.`, "List the jobs first.")
    const version = rows.draftRow(handle, id) ?? rows.activeVersionRow(handle, id)
    if (needDraft && !version) throw notFound(`Job ${id} has no version to confirm.`, "Save a draft first.")
    return { job, version: version ? { ...version, doc: JSON.parse(version.doc) } : null }
  }

  /** jobs.request: ask the person's host for the account this version reads, so they can confirm it. */
  async function request(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Asking to confirm a job needs the space's owner")
    return jobTx(spaceId, a, (handle) => {
      const { job, version } = jobAndVersion(handle, body)
      return jobConsent.requestConsent({ handle, actor: a, nowIso: nowIso() }, body, { job, version })
    })
  }

  /** jobs.probe: the person's own host reports the account it read. Owner-only. */
  async function probe(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "editor", "Reporting a job's account needs the editor role in this space")
    return withPause(spaceId, a, null, () =>
      jobTx(spaceId, a, (handle) => {
        const { job, version } = jobAndVersion(handle, body, { needDraft: false })
        // The account the host read must be one the connector's own consent
        // allows, so a probe cannot report an account nobody confirmed.
        if (body?.owner) {
          const problem = bindingProblem(handle, { connector: version.doc.connector, source: version.doc.source, account: version.doc.account, owner: body.owner, scope: version.doc.scope, grants: version.doc.grants, kinds: version.doc.kinds })
          if (problem) throw conflict(problem.code, problem.message, problem.next)
        }
        return jobConsent.probeConsent({ handle, actor: a, nowIso: nowIso() }, body, { job, version })
      }),
    )
  }

  /** The account owner the person's host reported, for the binding check at consent. */
  function reportedOwner(handle, job) {
    const request = rows.requestRow(handle, job.id)
    return request?.owner_id ? { id: request.owner_id, label: request.owner_label ?? request.owner_id } : null
  }

  /** Make a version the definition that runs, in the caller's transaction. */
  function activateIn(handle, job, version, a, at) {
    const doc = version.doc
    const previous = rows.activeVersionRow(handle, job.id)
    if (previous && previous.version !== version.version) rows.setVersionState(handle, job.id, previous.version, "superseded")
    rows.approveVersion(handle, job.id, version.version, { at, via: "session" })
    rows.applyDoc(handle, job.id, doc, { version: version.version, digest: version.digest, at })
    rows.setJobStatus(handle, job.id, "active", null, at)
    rows.setJobDue(handle, job.id, at, at)
    rows.deleteRequest(handle, job.id)
    return { job: job.id, version: version.version, by: a.user }
  }

  /** jobs.consent: the person confirms account, scope and grants in a browser, and the version becomes active. */
  async function consent(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Confirming a job needs the space's owner")
    personOnly(a, "Confirming a job", body)
    return jobTx(spaceId, a, (handle) => {
      const { job, version } = jobAndVersion(handle, body)
      // The consent names the version and digest the person was shown. Both are
      // required, as for activate: a consent that names neither approves
      // nothing in particular (review, item 1).
      const shownVersion = Number(body?.version)
      const shownDigest = String(body?.digest ?? "")
      if (!Number.isInteger(shownVersion) || !/^[0-9a-f]{64}$/.test(shownDigest)) {
        throw invalid("invalid_digest", "consent needs the version and digest the page showed you.", "Reload Jobs in Memory's console and confirm the version it shows.")
      }
      if (shownVersion !== Number(version.version) || shownDigest !== version.digest) {
        throw conflict("revision_conflict", `Job ${job.id} changed since you looked: version ${version.version} is not what the page showed.`, "Reload Jobs in Memory's console and confirm the version it shows.")
      }
      const owner = body?.owner ?? reportedOwner(handle, job)
      // With no reported account there is nothing to check the binding
      // against: consentJob answers `job_not_reported`, which says what to do.
      if (owner) {
        const problem = bindingProblem(handle, { connector: version.doc.connector, source: version.doc.source, account: version.doc.account, owner, scope: version.doc.scope, grants: version.doc.grants, kinds: version.doc.kinds })
        if (problem) throw conflict(problem.code, problem.message, problem.next)
      }
      const done = jobConsent.consentJob({ handle, actor: a, nowIso: nowIso() }, { ...body, owner }, { job, version })
      activateIn(handle, job, version, a, nowIso())
      return done
    })
  }

  /**
   * jobs.activate: make a draft active. **P1 only** (§5.5, §5.6): the person,
   * in a browser. A version within the recorded consent needs no new consent;
   * one that widens is refused with the delta and needs `jobs.consent`.
   */
  async function activate(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Activating a job needs the space's owner")
    personOnly(a, "Activating a job", body)
    const at = nowIso()
    return jobTx(spaceId, a, (handle) => {
      const { job, version } = jobAndVersion(handle, body)
      if (version.state !== "draft") throw conflict("job_no_draft", `Job ${job.id} has no draft above version ${job.version}.`, "Save a change first, then activate it.")
      // Approval is bound to what the person was shown: the digest is required,
      // and it must be this version's. A missing one is a caller that never
      // showed the page anything (review 3).
      const shown = String(body?.digest ?? "")
      if (!/^[0-9a-f]{64}$/.test(shown)) {
        throw invalid("invalid_digest", "activate needs the version's digest: the one the page showed you.", "Reload Jobs in Memory's console and approve the version it shows.")
      }
      if (shown !== version.digest) {
        throw conflict("revision_conflict", `Job ${job.id} changed since you looked: version ${version.version} is not what the page showed.`, "Reload Jobs in Memory's console and approve what it shows now.")
      }
      const consent = rows.consentRow(handle, job.id)
      if (!consent) throw conflict("job_consent_required", `Job ${job.id} has not been confirmed by the person, so only confirming it can turn it on.`, "Confirm the job in Memory's console, Jobs.")
      // A consent that is paused stays paused: approving a version underneath
      // it is not a new consent (review, item 2).
      if (consent.state !== "on") {
        throw conflict("job_consent_paused", `Job ${job.id}'s consent is ${consent.reason ?? consent.state}: approve it only by confirming it again.`, "Confirm the job again in Memory's console, Jobs.")
      }
      const verdict = jobConsent.wideningOf(consent, version.doc)
      if (verdict) {
        throw conflict("job_widening", `Version ${version.version} of ${job.id} widens what you confirmed: ${verdict.widening.slice(0, 3).join("; ")}.`, "Confirm the change in Memory's console, Jobs: it shows the diff and the new scope.", { widening: verdict.widening })
      }
      return activateIn(handle, job, version, a, at)
    })
  }

  /** jobs.pause: it only narrows, so a bearer may. */
  async function pauseJob(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Pausing a job needs the space's owner")
    const at = nowIso()
    return jobTx(spaceId, a, (handle) => {
      const { job } = jobAndVersion(handle, body, { needDraft: false })
      if (job.status === "draft") throw conflict("job_draft", `Job ${job.id} is a draft: it is not running, so there is nothing to pause.`, "Confirm it in Memory's console, Jobs, or delete it.")
      if (job.status === "archived") throw conflict("job_archived", `Job ${job.id} is archived.`, "Restore it first, or make a new job.")
      rows.setJobStatus(handle, job.id, "paused", typeof body?.reason === "string" ? body.reason.slice(0, 300) : "paused in Memory", at)
      return { job: rows.pubJob(rows.jobRow(handle, job.id)) }
    })
  }


  /**
   * A job's archive and resume need the person's proof (0.10 review; DESIGN-CRUD
   * revision 4): **P1** a console browser session, which the gateway marks
   * `x-records-credential: session`, or **P3** an agent's asked act whose commit
   * carries `expected_digest`, the state digest the preview showed. A bare
   * bearer's call is refused, and so is a digest of another state. Nothing is
   * written when either is refused.
   */
  function personProof(a, body, job) {
    if (a.credential === "session") return
    const sent = typeof body?.expected_digest === "string" ? body.expected_digest.trim() : ""
    if (!sent) {
      throw new RecordsError(
        400,
        "digest_required",
        "Archiving or resuming a job needs expected_digest: the state digest the person's preview showed.",
        "Read the job with mem_spaces jobs get (it names state_digest), show it, and send it back as job.expected_digest. The person can also act in Memory's console, Jobs.",
      )
    }
    const current = rows.stateDigest(job)
    if (sent !== current) {
      throw conflict("stale_state", "The job changed since the preview: its expected_digest no longer matches.", "Read the job again, show the person what it is now, and send its state_digest.")
    }
  }

  /** jobs.resume: G1. A job whose consent no longer holds stays paused and says why. */
  async function resume(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Resuming a job needs the space's owner")
    const at = nowIso()
    return jobTx(spaceId, a, (handle) => {
      const { job } = jobAndVersion(handle, body, { needDraft: false })
      // Resume returns a job to **its last consented active version** and to
      // nothing else: never a draft, and never a definition whose consent is
      // gone (the review's reproduction reached `active` at version 0 here).
      if (job.status === "draft") throw conflict("job_draft", `Job ${job.id} is a draft: only the person can confirm it, and a draft is never resumed.`, "Confirm it in Memory's console, Jobs.")
      if (job.status !== "paused" && job.status !== "archived") throw conflict("job_not_paused", `Job ${job.id} is ${job.status}.`, "Nothing to resume.")
      const problem = jobProblem(handle, job)
      if (problem) throw conflict(problem.code, problem.message, problem.next)
      personProof(a, body, job)
      rows.setJobStatus(handle, job.id, "active", null, at)
      rows.setJobDue(handle, job.id, at, at)
      return { job: rows.pubJob(rows.jobRow(handle, job.id)) }
    })
  }

  /** jobs.archive: it leaves the schedule and keeps its history and its block. */
  async function archive(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Archiving a job needs the space's owner")
    const at = nowIso()
    return jobTx(spaceId, a, (handle) => {
      const { job } = jobAndVersion(handle, body, { needDraft: false })
      // A draft has never run and is not archived: archiving it would let a
      // resume bring a never-consented version back (the review's finding).
      if (job.status === "draft") throw conflict("job_draft", `Job ${job.id} is a draft: only the person can confirm it, and a draft is never archived or resumed.`, "Confirm it in Memory's console, Jobs.")
      personProof(a, body, job)
      rows.setJobStatus(handle, job.id, "archived", "archived in Memory", at)
      return { job: rows.pubJob(rows.jobRow(handle, job.id)) }
    })
  }

  /**
   * jobs.remove: **G4, the person at a browser** (§5.6). It removes the job,
   * its versions and its consent. The runs stay (they are the history of what
   * it did), and the block it wrote stays on the page: withdrawing what a job
   * wrote is a separate, destructive act (`job.withdraw_outputs`), not this one.
   */
  async function remove(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Deleting a job needs the space's owner")
    personOnly(a, "Deleting a job", body)
    const id = typeof body?.job_id === "string" ? body.job_id : typeof body?.id === "string" ? body.id : null
    if (!id) throw invalid("invalid_job", "Deleting needs job_id.", "List the jobs first: mem_spaces jobs list.")
    const removed = await jobTx(spaceId, a, (handle) => {
      const job = rows.jobRow(handle, id)
      if (!job) throw notFound(`No job ${id} in this space.`, "List the jobs first.")
      if (body?.revision !== undefined && Number(body.revision) !== Number(job.version)) {
        throw conflict("revision_conflict", `Job ${id} is at version ${job.version}, not ${String(body.revision)}.`, "Reload Jobs in Memory's console and delete the job it shows.")
      }
      const kept = rows.runRows(handle, id, 1000).length
      rows.deleteJobRows(handle, id)
      return { job_id: id, page: job.page, runs_kept: kept }
    })
    log?.info?.({ event: "memory.job.remove", job: id })
    return removed
  }

  // -------------------------------------------------------------------------
  // Runs

  /**
   * Lease one run for this host, or nothing.
   * @returns {Promise<{run: object|null, why?: string}>}
   */
  async function claim(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "editor", "A job host needs the editor role in this space")
    const host = body?.host_id
    if (typeof host !== "string" || !HOST_ID.test(host)) throw invalid("invalid_host", "host_id must be a short stable id.", "Send the host's own id: letters, digits, dots, colons, hyphens or underscores.")
    const at = nowMs()
    // Every active job is judged against its consent before anything is leased.
    const blocked = await readHandle(spaceId, a, (handle) => rows.jobRows(handle).filter((job) => job.status === "active").map((job) => ({ job, problem: jobProblem(handle, job) })).filter((entry) => entry.problem))
    for (const entry of blocked) await pause(spaceId, a, entry.job, entry.problem)
    if (blocked.length) log?.warn?.({ event: "memory.job.paused", jobs: blocked.map((entry) => entry.job.id), reason: blocked[0].problem.message })
    return jobTx(spaceId, a, (handle) => {
      const nowIso = iso(at)
      // Every answer carries the scheduling hints a host may use (POLLING §5
      // cut 2); `run` and `why` are unchanged, so an older host ignores them.
      const answer = (value) => ({ ...value, ...hints(handle, nowIso, host) })
      // What this host may serve (lane 0189): null for a legacy host that has
      // never failed with "not here", or one that never reported, which keeps
      // today's code path below exactly. Otherwise a predicate on the connector.
      const allow = rows.abilityOf(rows.hostRow(handle, host))
      const running = rows.runningRuns(handle)
      // A live lease belongs to another host: two hosts, one writer.
      if (running.some((run) => run.lease_expires && run.lease_expires > nowIso)) return answer({ run: null, why: "leased" })
      // A dead host's run is re-claimable at a higher epoch (§4.2).
      const deadRuns = running.filter((run) => !run.lease_expires || run.lease_expires <= nowIso)
      const dead = allow === null ? deadRuns[0] : deadRuns.find((run) => allow(rows.jobRow(handle, run.job_id)?.connector))
      if (dead) {
        const job = rows.jobRow(handle, dead.job_id)
        if (!job || job.status !== "active") return answer({ run: null, why: "job_not_active" })
        rows.leaseRun(handle, dead.id, { host, epoch: dead.lease_epoch + 1, expires: iso(at + leaseMs), started: nowIso })
        rows.log(handle, dead.id, nowIso, "info", "job.lease", `epoch ${dead.lease_epoch + 1} to ${host}`)
        return answer({ run: rows.pubRun(rows.runRow(handle, dead.id)) })
      }
      // The scheduler's queue first, then a job that is due: a host runs without waiting for a tick.
      const queued = rows.queuedRun(handle, allow)
      if (queued) {
        rows.leaseRun(handle, queued.id, { host, epoch: 1, expires: iso(at + leaseMs), started: queued.started })
        rows.log(handle, queued.id, nowIso, "info", "job.lease", `epoch 1 to ${host}`)
        return answer({ run: rows.pubRun(rows.runRow(handle, queued.id)) })
      }
      const due = rows.activeJobsDue(handle, nowIso).find((job) => !rows.openRunForJob(handle, job.id) && (allow === null || allow(job.connector)))
      if (!due) {
        // A restricted host that was passed over says so, rather than "nothing_due",
        // when a run exists that another host could take.
        if (allow !== null && (deadRuns.length > 0 || rows.queuedRun(handle) || rows.activeJobsDue(handle, nowIso).some((job) => !rows.openRunForJob(handle, job.id)))) return answer({ run: null, why: "no_matching_run" })
        return answer({ run: null, why: "nothing_due" })
      }
      const run = freshRun(due, nowIso)
      rows.insertRun(handle, run)
      rows.leaseRun(handle, run.id, { host, epoch: 1, expires: iso(at + leaseMs), started: nowIso })
      rows.setJobDue(handle, due.id, nextDue(at, { every: due.every_ms, failures: due.failures }), nowIso)
      rows.log(handle, run.id, nowIso, "info", "job.claim", `epoch 1 to ${host}`)
      return answer({ run: rows.pubRun(rows.runRow(handle, run.id)) })
    })
  }

  function freshRun(job, nowIso) {
    return { id: `run_${ulid(nowMs())}`, job_id: job.id, version: job.version, digest: job.digest, status: "queued", started: nowIso, counts: {}, refusals: [] }
  }

  /** The run a caller may write to: it exists, it is running, and this epoch and lease are current. */
  function writable(handle, { run_id, epoch }) {
    const run = typeof run_id === "string" ? rows.runRow(handle, run_id) : null
    if (!run) throw notFound("No such run in this space.", "Claim a run first; its id is in the claim's answer.")
    const nowIso = iso(nowMs())
    if (run.status !== "running") throw conflict("lease_lost", `Run ${run.id} is ${run.status}; this host no longer holds it.`, "Stop this run and claim the next one: a finished or reclaimed run takes no more writes.")
    if (run.lease_epoch !== epoch) throw conflict("lease_lost", `Run ${run.id} is at epoch ${run.lease_epoch}, not ${String(epoch)}; another host holds it.`, "Stop writing: the items this host read are already counted, and the next host continues from the cursor.")
    if (!run.lease_expires || run.lease_expires <= nowIso) throw conflict("lease_lost", `The lease on run ${run.id} expired at ${run.lease_expires ?? "an unknown time"}.`, "Claim the run again; it comes back at the next epoch.")
    return { ...run, counts: parseJson(run.counts, {}), refusals: parseJson(run.refusals, []) }
  }

  /**
   * Store one page of what the host read, and move the job's cursor with it.
   * The page is refused item by item (§4.2, S2's checkIngest): a kind or a
   * channel the person did not confirm is never stored, and the refusal names
   * the item's key and the reason, never its text.
   */
  async function checkpoint(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "editor", "A job host needs the editor role in this space")
    const list = Array.isArray(body?.items) ? body.items : null
    if (!list) throw invalid("invalid_items", "checkpoint needs items: the events this page read.", "Send the events events_list answered, oldest first.")
    if (list.length > MAX_PAGE_ITEMS) throw invalid("invalid_items", `${list.length} items in one page; the limit is ${MAX_PAGE_ITEMS}.`, "Send the page's events in smaller pages.")
    if (typeof body.cursor_before !== "string" && body.cursor_before !== undefined && body.cursor_before !== null) throw invalid("invalid_cursor", "cursor_before must be text.", "Send the cursor the job held when this page was read, or \"\".")
    if (typeof body.cursor_after !== "string" && body.cursor_after !== undefined && body.cursor_after !== null) throw invalid("invalid_cursor", "cursor_after must be text.", "Send the cursor events_list answered.")
    // §8.3.4: the page's own refusals are final, and its retryable drops hold the
    // cursor back. Neither is an item the host sent; both are counted, never quoted.
    const pageRefused = Array.isArray(body.refused) ? body.refused.slice(0, 500) : []
    const pageFailed = Array.isArray(body.failed) ? body.failed.slice(0, 500) : []
    const epoch = Number(body.epoch)
    if (!Number.isInteger(epoch) || epoch < 1) throw invalid("invalid_epoch", "epoch must be the lease epoch this host claimed.", "Send the epoch from the claim's answer.")
    const at = nowMs()
    return withPause(spaceId, a, body.run_id, () => jobTx(spaceId, a, (handle) => {
      const run = writable(handle, { run_id: body.run_id, epoch })
      const job = rows.jobRow(handle, run.job_id)
      if (!job) throw notFound("The run's job is gone.", "Nothing to do: the job was deleted.")
      const problem = jobProblem(handle, job)
      if (problem) throw conflict(problem.code, problem.message, problem.next)
      const held = job.cursor ?? ""
      const before = body.cursor_before ?? ""
      // §9.3 first: a page may say its source restarted its window. That is read
      // before the cursor is compared, because a resync moves the cursor.
      const nowIso = iso(at)
      let resync = false
      let incomplete = false
      const heldByFailed = pageFailed.length > 0
      // A page's `failed[]` carries a code, and a source that sends none falls
      // back to its own words: redacted before the slice, never after, because
      // the token sits early in the text (0.11 review B1).
      const failedReason = heldByFailed ? errorText(String(pageFailed[0]?.code ?? pageFailed[0]?.reason ?? "a retryable drop"), 100) : null
      const gap = readGap(body.gap, at)
      if (gap) {
        incomplete = true
        if (gap.reason !== "window-truncated") {
          const day = nowIso.slice(0, 10)
          // §9.3: the limit belongs to the **binding** — the source and account
          // the person confirmed — so two jobs on it share one resync a day, and
          // the second gap pauses the binding, not only the job that saw it.
          if (rows.resyncOf(handle, job.source, job.account, day)) {
            const error = conflict(
              "job_resync_limit",
              `${job.source} (${job.account}) restarted its window twice today; the binding waits until tomorrow rather than read a third time blind.`,
              "Look at the source in Memory's console, then turn the source back on tomorrow, or now if it is healthy again.",
            )
            error.binding = { pluginId: job.connector, source: job.source, account: job.account }
            throw error
          }
          rows.setResync(handle, { source: job.source, account: job.account, day, job_id: job.id, run_id: run.id, reason: gap.reason, since: gap.since, at: nowIso })
          resync = true
        }
      }
      if (before !== held) {
        throw conflict("cursor_conflict", `This page was read from cursor "${before.slice(0, 40)}" but the job holds "${held.slice(0, 40)}".`, "Re-read from the job's cursor and send the page again; the cursor is saved with the events.")
      }
      // S2's ingest refusals first: a paused or re-owned plugin consent refuses the page.
      const declared = pluginConsent.checkIngest(handle, { source: job.source, account: job.account, owner: { id: job.owner_id, label: job.owner_label }, scope: body.scope }, list)
      const scope = typeof body.scope === "object" && body.scope !== null ? body.scope : null
      const confirmed = parseJson(job.scope, {})
      const kinds = parseJson(job.kinds, [])
      const pageOut = scope !== null && !scopeWithin(scope, confirmed)
      let accepted = 0
      let duplicates = 0
      let withdrawn = 0
      const refused = []
      // The reason is the source's own sentence, kept in `job_runs.refusals` and
      // answered by `jobs.runs`: redacted before the slice (0.11 review B1).
      for (const entry of pageRefused) refused.push(dbRefusal(keyOf(entry), `the page refused it: ${errorText(String(entry?.reason ?? "no reason"), 100)}`))
      for (const refusal of declared.refusals) refused.push(dbRefusal(refusal.external_id, refusal.reason))
      const kept = pageOut ? [] : declared.events
      if (pageOut) {
        for (const raw of declared.events) refused.push(dbRefusal(keyOf(raw), `the page names a scope outside the job's confirmed ${JSON.stringify(confirmed).slice(0, 80)}`))
      }
      for (const raw of kept) {
        const { event, error } = normalizeEvent(raw, { source: job.source, account: job.account })
        if (error) {
          refused.push(dbRefusal(keyOf(raw), error))
          continue
        }
        if (kinds.length && !kinds.includes(event.kind)) {
          refused.push(dbRefusal(event.external_id, `kind "${String(event.kind).slice(0, 20)}" is not one the job collects`))
          continue
        }
        // A channel-scoped job fails **closed**: an event that names no channel is
        // not evidence that it came from a confirmed one (review P3).
        const channels = channelsOf(event.labels)
        const allowedChannels = Array.isArray(confirmed.channels) ? confirmed.channels : []
        if (allowedChannels.length) {
          if (channels.length === 0) {
            refused.push(dbRefusal(event.external_id, "the event names no channel, and this job reads only confirmed channels"))
            continue
          }
          const outside = channels.filter((channel) => !allowedChannels.includes(channel))
          if (outside.length) {
            refused.push(dbRefusal(event.external_id, `channel ${outside[0]} is outside the job's confirmed scope`))
            continue
          }
        }
        // §6.2: a cancellation is the same id listed again with the label
        // `cancelled`. The item is withdrawn, so its lines and its proposals
        // leave the block rather than staying as if the meeting still stood.
        if (event.labels.includes("cancelled")) {
          rows.withdraw(handle, { job_id: job.id, connector: job.connector, account: job.account, external_id: event.external_id, run_id: run.id, at: nowIso })
          withdrawn += 1
          continue
        }
        // The item key is global (connector, account, external_id); this job's
        // curate state over it is its own (§4.2).
        if (rows.curateKey(handle, job.id, job.connector, job.account, event.external_id)) {
          duplicates += 1
          continue
        }
        const id = eventIdOf(job.source, job.account, event.external_id)
        // A row the collector already stored is the same event, shared by every
        // job that reads it (item keys are per job). The future rule is for a
        // new event only (0197), so a stored far-future row is accepted into
        // this job rather than refused.
        const held = handle.get("select hash from events where id = ?", id)
        // A new item cannot be a month ahead, as in the store's ingest (0197):
        // the job checkpoint shares the rule rather than letting a connector's
        // unbounded first read fill the job with instances that have not
        // happened. Nothing is deleted here.
        if (!held && isFarFuture(event.occurred_at, nowIso)) {
          refused.push(dbRefusal(event.external_id, FUTURE_EVENT_REASON))
          continue
        }
        storeEvent(handle, job.source, job.account, event, id, nowIso)
        const stored = { job_id: job.id, connector: job.connector, account: job.account, external_id: event.external_id, event_id: id, run_id: run.id, occurred_at: event.occurred_at, stored: nowIso }
        rows.insertItem(handle, stored)
        rows.insertCuration(handle, stored)
        accepted += 1
      }
      const counts = addCounts(run.counts, { accepted, duplicates, withdrawn, refused: refused.length })
      const refusals = [...run.refusals, ...refused].slice(0, MAX_REFUSALS)
      const cursorAfter = typeof body.cursor_after === "string" && body.cursor_after ? body.cursor_after : null
      // The cursor moves only when the page was taken: a refused page must not skip the events.
      const move = !heldByFailed && accepted + duplicates + withdrawn > 0 && cursorAfter !== null
      rows.setRunCounts(handle, run.id, counts, refusals, move ? cursorAfter : undefined)
      if (move) rows.setJobCursor(handle, job.id, cursorAfter, nowIso)
      rows.renewLease(handle, run.id, iso(at + leaseMs))
      rows.log(handle, run.id, nowIso, refused.length || heldByFailed ? "warn" : "info", "job.checkpoint", `accepted ${accepted}, duplicates ${duplicates}, refused ${refused.length}${move ? "" : ", cursor held"}${failedReason ? ` (${failedReason})` : ""}`)
      const answer = { run_id: run.id, accepted, duplicates, withdrawn, refused: refused.length, refusals, cursor: move ? cursorAfter : held, counts, ...(heldByFailed ? { held: "failed", failed: pageFailed.length, reason: failedReason } : {}), ...(gap ? { resync, incomplete } : {}) }
      return answer
    }))
  }

  /** End the run: the items are counted, the lease is gone, and the cursor is where the host left it. */
  async function finish(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "editor", "A job host needs the editor role in this space")
    const epoch = Number(body?.epoch)
    if (!Number.isInteger(epoch) || epoch < 1) throw invalid("invalid_epoch", "epoch must be the lease epoch this host claimed.", "Send the epoch from the claim's answer.")
    const outcome = body?.outcome === "ok" ? "ok" : "failed"
    const at = nowMs()
    const done = await withPause(spaceId, a, body?.run_id, () => jobTx(spaceId, a, (handle) => {
      const run = writable(handle, { run_id: body?.run_id, epoch })
      const job = rows.jobRow(handle, run.job_id)
      if (!job) throw notFound("The run's job is gone.", "Nothing to do: the job was deleted.")
      const nowIso = iso(at)
      // A binding that stopped holding does not un-end a run: the run is over,
      // and leaving it `running` would hold its lease over the whole binding, so
      // no host could claim anything until it expired. The job is paused here
      // instead, with the reason, and the run records its outcome.
      const problem = jobProblem(handle, job)
      if (problem) {
        rows.setJobStatus(handle, job.id, "paused", problem.message, nowIso)
        rows.log(handle, run.id, nowIso, "warn", "job.paused", problem.message)
      }
      // The checkpoint owns the item counts: it is the one that wrote them. Finish
      // may add what only the host knows (tool calls, pages), never a second count.
      const reported = isCounts(body?.counts) ? body.counts : {}
      const counts = { ...run.counts, ...(Number(reported.tool_calls) ? { tool_calls: Number(reported.tool_calls) } : {}), ...(Number(reported.pages) ? { pages: Number(reported.pages) } : {}) }
      // Redacted before the slice: a token cut at the boundary is short enough to
      // slip the backstop, and this text is stored and shown (round 2, S2).
      const error = typeof body?.error === "string" && body.error ? errorText(body.error, 300) : null
      rows.setRunCounts(handle, run.id, counts, run.refusals)
      rows.endRun(handle, run.id, { status: outcome, outcome, error, finished: nowIso })
      // The connector is not on this host (lane 0189): not the job's failure. The
      // host says so by code, or a host built before the code says it in the
      // plugin's own words (connectorMissingMessages). The run is recorded
      // failed, the job's `failures` and reason stay as they were, the job is due
      // again for a host that can read it, and this host is not leased the
      // connector again for as long as it lives.
      const unavailable = outcome === "failed" && (body?.error_code === CONNECTOR_UNAVAILABLE || (error !== null && connectorMissingMessages(job.connector).includes(error)))
      if (unavailable) {
        if (run.lease_host) rows.markIncapable(handle, run.lease_host, job.connector, nowIso)
        rows.setJobDue(handle, job.id, nowIso, nowIso)
        rows.log(handle, run.id, nowIso, "warn", "job.connector_unavailable", `${run.lease_host ?? "a host"} has no ${job.connector}; not counted as a failure`)
        rows.log(handle, run.id, nowIso, "error", "job.finish", `${outcome}${error ? `: ${error}` : ""}`)
        return { run: rows.pubRun(rows.runRow(handle, run.id)) }
      }
      const failures = outcome === "ok" ? 0 : Number(job.failures) + 1
      if (failures >= BREAKER_FAILURES) {
        rows.setJobFailures(handle, job.id, failures, `${failures} failed runs in a row: ${error ?? "no reason given"}`, nowIso)
        rows.setJobStatus(handle, job.id, "paused", `${failures} failed runs in a row: ${error ?? "no reason given"}`, nowIso)
        rows.log(handle, run.id, nowIso, "error", "job.breaker", `paused after ${failures} failures`)
      } else {
        rows.setJobFailures(handle, job.id, failures, error, nowIso)
        rows.setJobDue(handle, job.id, nextDue(at, { every: job.every_ms, failures }), nowIso)
      }
      rows.log(handle, run.id, nowIso, outcome === "ok" ? "info" : "error", "job.finish", `${outcome}${error ? `: ${error}` : ""}`)
      return { run: rows.pubRun(rows.runRow(handle, run.id)) }
    }))
    // Curate after the finish commits, so a page that cannot be written never
    // hides the run: the tick curates the run again on its next pass.
    let curated
    try {
      curated = await curate(spaceId, { run_id: done.run.id }, actor)
    } catch (error) {
      curated = { curated: false, error: errorText(String(error?.message ?? error), 200) }
      log?.warn?.({ event: "memory.job.curate.failed", run: done.run.id, error: curated.error })
    }
    return { ...done, curate: curated }
  }

  // -------------------------------------------------------------------------
  // Curate: the `render` engine, one lens block on one page (§6.1, §6.2)

  async function curate(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "editor", "Curating a run needs the editor role in this space")
    const run = await readHandle(spaceId, a, (handle) => (typeof body?.run_id === "string" ? rows.pubRun(rows.runRow(handle, body.run_id)) : null))
    if (!run) throw notFound("No such run in this space.", "Read the runs first: each one names its job.")
    // Only a finished run is curated: a queued or running one is still being read.
    if (run.status !== "ok" && run.status !== "failed") {
      throw conflict("job_run_open", `Run ${run.id} is ${run.status}; curate reads what a finished run stored.`, "Finish the run first (jobs.finish), then curate it.")
    }
    if (run.curated) return { curated: false, skipped: "already", run_id: run.id }
    const job = await readHandle(spaceId, a, (handle) => rows.pubJob(rows.jobRow(handle, run.job_id)))
    if (!job) throw notFound("The run's job is gone.", "Nothing to curate: the job was deleted.")
    // Withdrawn items stay staged (their event is real), but they are not
    // evidence any more: §6.2's tombstone keeps them out of the block.
    const gone = await readHandle(spaceId, a, (handle) => rows.withdrawnIds(handle, job.id))
    const staged = await readHandle(spaceId, a, (handle) => itemsFor(handle, job.id))
    const all = staged.filter((item) => !gone.has(`${job.connector}\u0000${job.account}\u0000${item.external_id}`))
    const prior = all.filter((item) => item.curated === 1)
    // The `extract` engine (J4) runs before the block is rebuilt: proposals are
    // independent of the lens block, and a failure there never loses the block.
    let extract = null
    try {
      extract = await extractFor(spaceId, a, { job, run })
    } catch (error) {
      log?.warn?.({ event: "memory.job.extract.error", job: job.id, run: run.id, error: errorText(String(error?.message ?? error), 200) })
      extract = { skipped: "error", error: errorText(String(error?.message ?? error), 160) }
    }
    const maxLines = Math.max(1, Number(job.curate?.[0]?.maxLines) || 100)
    const sp = space(spaceId)
    // A journal stage writes the day's journal page (§9.4's `into: journal`),
    // so the page is the run's day rather than a page the job was given.
    const path = job.page === JOURNAL_PAGE ? `journal/${String(run.finished ?? nowIso()).slice(0, 10)}` : job.page
    const page = (await sp.get({ paths: [path] }, a)).records[0] ?? null
    const { block, hadBlock } = splitLensBlock(page?.body, job.id, job.stage)
    // The block belongs to the render stage; a template may list extract first (§9.4).
    const curateList = Array.isArray(job.curate) ? job.curate : []
    const stage = curateList.find((entry) => entry?.engine === "render") ?? curateList[0] ?? {}
    const renderOptions = { maxLines, line: typeof stage.line === "string" ? stage.line : null, unit: stage.select?.unit ?? null, urlHosts: Array.isArray(job.urlHosts) ? job.urlHosts : [] }
    const expected = renderLines({ items: prior, ...renderOptions })
    const lines = renderLines({ items: all, ...renderOptions })
    // Staleness (§6.2): a block whose newest citation is old is marked stale,
    // from ids only. The quality loop (§6.3) then decides whether the version
    // keeps asking: most of what it proposed was rejected.
    const stale = staleness({ lines, citedAt: new Map(all.map((item) => [item.event_id, item.occurred_at])), now: now(), staleAfterDays })
    if (stale.stale) log?.warn?.({ event: "memory.job.block.stale", job: job.id, run: run.id, newest: stale.newest, age_days: stale.ageDays })
    const quality = await qualityCheck(spaceId, job)
    // The block the job last wrote is remembered here, not on the page: a
    // client write cannot claim a block is the job's (review follow-up 3).
    const wrote = await readHandle(spaceId, a, (handle) => rows.lensHashOf(handle, job.id))
    // The record carries the hash of the block the job wrote, so a run that died
    // between the write and its mark still knows the block is its own (P1).
    if (hadBlock && !unedited(block, expected, { wrote, next: lines })) {
      // A person edited inside the block: the job stops owning it, and what it
      // would have written becomes a proposal for them to accept (§6.2, P2).
      const added = lines.filter((line) => !expected.includes(line))
      const fresh = all.find((item) => item.curated !== 1) ?? null
      // The proposal comes first: only once it is stored does the run count as
      // curated, so a failure here is retried rather than lost.
      const proposed = added.length ? await propose(spaceId, a, { job, run, lines: added, event: fresh?.event_id ?? null }) : null
      await jobTx(spaceId, a, (handle) => {
        rows.log(handle, run.id, nowIso(), "warn", "job.lens.edited", `the block holds a person's edit; ${added.length} new line(s) proposed instead`)
        rows.markRunCurated(handle, run.id, nowIso())
        rows.markItemsCurated(handle, job.id)
      })
      log?.warn?.({ event: "memory.job.lens.edited", job: job.id, run: run.id, proposed: Boolean(proposed) })
      return { curated: false, skipped: "edited", proposed: Boolean(proposed), proposal: proposed?.id ?? null, run_id: run.id, ...(extract ? { extract } : {}), ...(stale.stale ? { stale } : {}), ...(quality.paused ? { quality } : {}) }
    }
    // Nothing to say yet (a failed first run, or every item refused): no empty
    // block, and no page made just to hold one.
    if (!hadBlock && lines.length === 0) {
      await markCurated(spaceId, a, job.id, run.id)
      return { curated: true, written: false, lines: 0, run_id: run.id, ...(extract ? { extract } : {}), ...(stale.stale ? { stale } : {}), ...(quality.paused ? { quality } : {}) }
    }
    const nextBody = mergeLensBlock(page?.body ?? "", job.id, job.stage, lines)
    const fields = { ...(page?.fields ?? {}), owner_job: job.id, lens_version: job.version }
    if (page && page.body === nextBody && sameFields(page.fields, fields)) {
      await markCurated(spaceId, a, job.id, run.id, lensHash(lines))
      return { curated: true, written: false, lines: lines.length, run_id: run.id, ...(extract ? { extract } : {}), ...(stale.stale ? { stale } : {}), ...(quality.paused ? { quality } : {}) }
    }
    const journal = path.startsWith("journal/")
    const title = journal ? `Journal ${path.slice("journal/".length)}` : pageTitle(pageTitleOf(job))
    const record = page
      ? { kind: "page", id: page.id, body: nextBody, fields, base_version: page.version, ...(page.title ? {} : { title }) }
      : { kind: "page", type: journal ? "journal" : "project", path, title, body: nextBody, fields }
    // The page and the hash of the block it now holds commit together.
    await sp.jobWritePage(a, { record, upsert_path: true }, (handle) => {
      rows.markRunCurated(handle, run.id, nowIso())
      rows.markItemsCurated(handle, job.id)
      rows.setLensHash(handle, job.id, lensHash(lines), run.id, nowIso())
    })
    log?.info?.({ event: "memory.job.curate", job: job.id, run: run.id, engine: "render", lines: lines.length })
    return { curated: true, written: true, lines: lines.length, run_id: run.id, ...(extract ? { extract } : {}), ...(stale.stale ? { stale } : {}), ...(quality.paused ? { quality } : {}) }
  }

  /**
   * The quality loop (§6.3): a version with at least `qualityMinDecisions`
   * decided proposals and more than `qualityMaxReject` rejected is paused, with
   * the reason, so it stops asking a person who keeps saying no.
   */
  async function qualityCheck(spaceId, job) {
    const sys = jobsActor(spaceId)
    const records = await readHandle(spaceId, sys, (handle) =>
      handle.all("select status, json_extract(fields, '$.version') as version from records where kind = 'proposal' and json_extract(fields, '$.job') = ?", job.id),
    )
    if (records.length === 0) return { paused: false, versions: [] }
    const versions = qualityOf(records, { minDecisions: qualityMinDecisions, maxReject: qualityMaxReject })
    const running = versions.find((entry) => entry.version === Number(job.version) && entry.pause)
    if (!running) return { paused: false, versions }
    await jobTx(spaceId, sys, (handle) => {
      rows.setJobStatus(handle, job.id, "paused", `most of version ${job.version}'s proposals were rejected (${running.rejected} of ${running.decided})`, nowIso())
    })
    log?.warn?.({ event: "memory.job.quality", job: job.id, version: running.version, rejected: running.rejected, decided: running.decided })
    return { paused: true, version: running.version, rejected: running.rejected, decided: running.decided, versions }
  }

  /**
   * The `extract` engine (J4, §6.1): proposals only, from the job's own items,
   * through the routines' frame, validator, policy and guards.
   *
   * It is off unless the deployment turns it on, and it never throws into
   * curate: a model failure is counted and logged, and the job's own breaker
   * (three failed runs) and the routines' model breaker decide whether the next
   * run calls the model at all.
   *
   * @returns {Promise<{skipped?: string, proposals?: number, tokens?: number, withdrawn?: number}>}
   */
  async function extractFor(spaceId, caller, { job: jobRow, run }) {
    let job = jobRow
    // The engine writes as the runner's own system principal, never as the
    // caller: a person's act (curate) must not put their name on a proposal the
    // job made, and the store's forgotten check is the service's, not theirs.
    const a = jobsActor(spaceId)
    const stage = extractStage(job)
    if (!stage) return { skipped: "no_stage" }
    const outputs = outputsOf(job, stage)
    if (outputs.size === 0) return { skipped: "no_outputs" }
    if (extractMode !== "on") return { skipped: "off" }
    if (!rawLlm?.available) return { skipped: "no_model" }

    const at = nowMs()
    // The space's own local day (its index page's `fields.tz`), which is the
    // window the routines' budget uses too: an evening run in New York is that
    // day's, never the next UTC day's.
    const indexPage = await space(spaceId).get({ paths: ["index"] }, a).then((answer) => answer.records?.[0] ?? null)
    const tz = safeTz(indexPage?.fields?.tz ?? "UTC")
    const day = localDay(now(), tz)
    const spentByJob = await readHandle(spaceId, a, (handle) =>
      Number(
        handle.get(
          "select coalesce(sum(coalesce(json_extract(counts, '$.tokens'), 0)), 0) as tokens from job_runs where job_id = ? and started >= ?",
          job.id,
          `${day}T00:00:00.000Z`,
        )?.tokens,
      ) || 0,
    )
    // The space's one budget is the routines' `runs` and the jobs' `job_runs`
    // together (0.11); the job's own day and the jobs' service cap stay as
    // narrow caps inside it, so one noisy job cannot spend what the others need.
    const shared = await modelGuard.usage(spaceId, { day, tz })
    const runCap = Math.min(Number(job.budgets?.tokensPerRun) || extractBudget, 25_000, extractBudget)
    const remaining = Math.min(
      runCap,
      Math.max(0, jobDailyTokens - spentByJob),
      Math.max(0, extractServiceTokens - shared.jobs),
      Math.max(0, modelGuard.limit - shared.used),
    )
    if (remaining <= 0) return { skipped: "budget", service: extractServiceTokens - shared.jobs <= 0 }
    // The one breaker, routines and jobs together: open, no call from either.
    // Asked after the budget so a spent day still says "budget", not "breaker".
    if (modelGuard.openUntil(spaceId)) return { skipped: "breaker" }

    // A session capture owns is curated from capture, never from these items
    // (B8): skipped, counted, and nothing deleted.
    const sessionSkipped = await readHandle(spaceId, a, (handle) => sessionsSkipped(handle, job.id))
    // What the job holds: its own items, the space's index, its open
    // commitments, and the ids the source withdrew.
    const [items, pages, commitments, goneIds] = await Promise.all([
      readHandle(spaceId, a, (handle) => itemsFor(handle, job.id)),
      space(spaceId).list({ kind: "page", limit: 200 }, a).then((page) => page.records ?? []),
      space(spaceId).list({ kind: "commitment", status: "all", limit: 200 }, a).then((page) => page.records ?? []),
      readHandle(spaceId, a, (handle) => rows.withdrawnIds(handle, job.id)),
    ])
    // Only what the model has never seen (J4 review, finding 4): a run sends its
    // own new items, and a batch that failed sends again because its items were
    // never marked.
    const already = await readHandle(spaceId, a, (handle) => rows.extractedIds(handle, job.id))
    const keyOf = (item) => `${job.connector}\u0000${job.account}\u0000${item.external_id}`
    // A withdrawal retires the proposals it caused, before anything is added
    // (§6.2): a deleted message or a cancelled meeting never leaves one behind.
    const withdrawnEvents = items.filter((item) => goneIds.has(`${job.connector}\u0000${job.account}\u0000${item.external_id}`)).map((item) => item.event_id)
    let withdrawn = 0
    if (withdrawnEvents.length > 0) {
      const done = await retireProposals(space(spaceId), a, { jobId: job.id, eventIds: withdrawnEvents })
      withdrawn = done.retired.length
    }

    const people = pages.filter((page) => page.type === "person")
    const index = buildIndex({ people, projects: pages.filter((page) => page.type === "project") })
    // A known person page's name or alias is evidence that a line names
    // somebody, even without punctuation (J4 final check).
    const known = people.flatMap((page) => [page.title, ...(Array.isArray(page.fields?.aliases) ? page.fields.aliases : [])]).filter((name) => typeof name === "string" && name.trim())
    job = { ...job, known_names: known }
    const person = personFor(job, indexPage)
    // The thread's history decides `minEvents`; only what the model has never
    // seen is sent (J4 review, finding 4; re-check, finding 5).
    const live = items.filter((item) => !goneIds.has(keyOf(item)))
    const fresh = new Set(live.filter((item) => !already.has(keyOf(item))).map((item) => item.event_id))
    const plan = planUnits({
      job,
      items: live,
      index,
      person,
      stage,
      maxUnits: Number(stage.select?.maxUnits) || 40,
      minEvents: Number(stage.select?.minEvents) || 0,
      fresh,
    })
    const openCommitments = new Map(commitments.map((record) => [record.id, record]))
    const openList = [...openCommitments.values()].filter((record) => (record.fields?.state ?? "open") === "open")
    const dayOfRun = String(run.finished ?? run.started ?? nowIso()).slice(0, 10)

    const proposals = []
    const rejected = {}
    const sent = []
    const heldTraitRefs = new Set()
    // The gate's tokens are the run's, and the space's day pays for them
    // (design §5.4): its client counts them, and refuses a call the run's
    // allowance cannot carry.
    const traitGate = createTraitGate({
      llm: jobGateClient({
        llm: rawLlm,
        spent: () => tokens,
        budgetAt: remaining,
        breakerOpen: () => Boolean(modelGuard.openUntil(spaceId) || modelGuard.cellOpenUntil?.()),
        onCall: (used) => {
          tokens += used
          calls += 1
        },
      }),
      // One trait breaker for the cell, shared with the routines (design §10.4).
      breaker: traitBreakerOfCell(),
    })
    let traitDropped = 0
    let traitHeld = 0
    let withheld = 0
    let tokens = 0
    let calls = 0
    let stopped = null
    for (const units of batchUnits(plan.units)) {
      const batchRefs = batchRefsOf(units)
      const prompt = buildJobPrompt({ job, day: dayOfRun, person, index, units, hints: stage.hints, openCommitments: openList, batchRefs })
      const estimate = estimateTokens(prompt.system) + estimateTokens(prompt.user) + 1500
      if (tokens + estimate > remaining) {
        stopped = "budget"
        break
      }
      calls += 1
      let answer
      try {
        answer = await rawLlm.complete({ system: prompt.system, user: prompt.user })
        modelGuard.ok(spaceId)
      } catch (error) {
        const breaker = modelGuard.fail(spaceId, error)
        if (breaker.opened) log?.error?.({ event: "memory.job.extract.breaker", job: job.id, until: iso(breaker.until) })
        log?.warn?.({ event: "memory.job.extract.failed", job: job.id, run: run.id, error: errorText(String(error?.message ?? error), 200) })
        stopped = "model"
        break
      }
      tokens += Number(answer?.usage?.total) || estimate
      for (const unit of units) for (const item of unit.items) sent.push(item.ref)
      const accepted = acceptedItems({ answer: answer?.json, day: dayOfRun, refs: plan.refs, batchRefs, index, outputs, commitments: openCommitments })
      for (const entry of accepted.dropped) rejected[entry.reason] = (rejected[entry.reason] ?? 0) + 1
      withheld += Number(accepted.withheld) || 0
      // The trait gate before filing (design §5.4): a job's proposals take the
      // same check as a routine's. A claim that infers a sensitive trait is
      // never proposed, and one the classifier cannot answer is not filed
      // either: its event stays unmarked, so a later run reads it again.
      const verdict = await gateJobClaims({ gate: traitGate, items: accepted.accepted })
      traitDropped += verdict.dropped.length
      traitHeld += verdict.held.length
      for (const ref of verdict.heldRefs) heldTraitRefs.add(ref)
      for (const [index, item] of accepted.accepted.entries()) if (verdict.kept.has(index)) proposals.push(proposalOf(item, { job, run, index }))
    }
    // Entities once per run, from what the units named (§6.2): a person is
    // proposed, never created, and a known identity is never a second page.
    proposals.push(...entityProposals({ prep: plan, index, job, run, outputs }))
    const projectLink = projectLinkOf(job, run, index, stage)
    if (projectLink) proposals.push(projectLink)

    const written = proposals.length ? await writeProposals(space(spaceId), a, proposals) : { written: [], duplicates: 0, forgotten: 0, refused: [] }
    const counts = { proposals: written.written.length, ...(tokens ? { tokens } : {}), ...(sessionSkipped ? { sessions_skipped: sessionSkipped } : {}) }
    await jobTx(spaceId, a, (handle) => {
      const row = rows.runRow(handle, run.id)
      if (!row) return
      rows.setRunCounts(handle, run.id, addCounts(parseJson(row.counts, {}), counts), parseJson(row.refusals, []))
      for (const ref of sent) {
        // An item its trait gate held is read again by a later run, never
        // dropped: it is simply not marked as done.
        if (heldTraitRefs.has(ref)) continue
        const item = items.find((entry) => entry.event_id === ref)
        if (item) rows.markExtracted(handle, { job_id: job.id, connector: job.connector, account: job.account, external_id: item.external_id, run_id: run.id, at: nowIso() })
      }
      rows.log(
        handle,
        run.id,
        nowIso(),
        written.refused.length ? "warn" : "info",
        "job.extract",
        `${written.written.length} proposed, ${written.duplicates} already proposed, ${written.forgotten} forgotten, ${withdrawn} withdrawn by the source, ${calls} model call(s)`,
      )
    })
    log?.info?.({ event: "memory.job.extract", job: job.id, run: run.id, proposed: written.written.length, duplicates: written.duplicates, forbidden_text: written.forgotten, withdrawn, calls, tokens, rejected })
    if (traitDropped > 0 || traitHeld > 0) log?.info?.({ event: "memory.job.traits", job: job.id, run: run.id, dropped: traitDropped, held: traitHeld })
    return {
      proposals: written.written.length,
      duplicates: written.duplicates,
      forgotten: written.forgotten,
      refused: written.refused.length,
      withdrawn,
      sessions_skipped: sessionSkipped,
      tokens,
      calls,
      rejected,
      withheld,
      ...(traitDropped ? { traits_dropped: traitDropped } : {}),
      ...(traitHeld ? { traits_held: traitHeld } : {}),
      ...(stopped && written.written.length === 0 ? { skipped: stopped } : {}),
    }
  }

  /**
   * Meeting pages → proposals (0.11, opencode-mem#58 item 2; the owner's
   * decision of 2026-11-14).
   *
   * **A save is the trigger, and the tick is the moment.** The store tells this
   * runner which space a meeting page was written in, and the next tick reads
   * that space only. A page whose notes and transcript are unchanged since its
   * last pass proposes nothing (its digest is remembered), and a proposal is
   * keyed by its own content, so a re-save never duplicates one that waits.
   *
   * **Nothing is ever saved.** Every output is a proposal in review: the person
   * accepts, edits or rejects it before a memory, commitment or page exists.
   * `extract`'s direct-save default stays off; this path has no direct mode.
   *
   * **The space is the scope.** A personal meeting's proposals are written in
   * the person's own space; a team meeting's, in the team's space, where only
   * its members read them. Nothing is copied to another space, and nothing
   * leaves the space the page lives in.
   *
   * **One budget, one breaker.** It spends the space's shared day (model-guard)
   * and respects the one breaker, so a meeting pass never calls a model the
   * routines and the jobs cannot call.
   *
   * @returns {Promise<{skipped?: string, proposed?: number, meetings?: number, tokens?: number, rejected?: object}>}
   */
  /**
   * Withdraw a deleted meeting page's proposals (0.11 review, should-fix 1 and
   * the re-review). It runs **whatever the switch says**: turning proposals off
   * must not keep a deleted page's quotes in the space, so the retirement is
   * not behind `meetingMode`.
   */
  async function retireGoneMeetings(spaceId) {
    const a = jobsActor(spaceId)
    const pending = await readHandle(spaceId, a, (handle) => rows.meetingPendingPaths(handle))
    if (pending.size === 0) return { retired: 0 }
    const pages = await readHandle(spaceId, a, (handle) => rows.meetingPagePaths(handle))
    let retired = 0
    for (const gonePath of [...pending].filter((waiting) => !pages.has(waiting))) {
      const done = await retireMeetingProposals(space(spaceId), a, { path: gonePath })
      retired += done.retired.length
      await jobTx(spaceId, a, (handle) => {
        rows.clearMeetingMark(handle, gonePath)
        rows.clearMeetingPending(handle, gonePath)
      })
    }
    return { retired }
  }

  /**
   * The waiting proposals a re-read page no longer supports: a line edited out
   * of the page leaves its proposal open with a quote the page cannot show, so
   * it is retired and scrubbed (0.11 review, should-fix 2). Accepted proposals
   * are never touched: they are already a record of their own.
   */
  async function retireEditedOut(sp, a, page, created = []) {
    // Both sides go through the same normalisation the quote was stored with:
    // a page's markdown (bold, a link's destination, a list marker) is not the
    // quote's text, and comparing raw markdown retired a line in the same pass
    // that created it (0.11 review, should-fix 1).
    const normalise = (value) => fold(visibleText(String(value ?? ""))).replace(/\s+/g, " ").trim()
    const text = normalise(meetingText(page))
    const fresh = new Set(created)
    const open = (await sp.list({ kind: "proposal", status: "proposed", limit: 200 }, a)).records.filter((proposal) => proposal.fields?.meeting_id === page.id)
    let retired = 0
    for (const proposal of open) {
      // A proposal this pass created is never retired by this pass.
      if (fresh.has(proposal.id)) continue
      const quote = proposal.fields?.evidence?.[0]?.quote
      if (typeof quote !== "string" || !quote.trim()) continue
      if (text.includes(normalise(quote))) continue
      try {
        const done = await sp.retireMeetingProposal({ id: proposal.id, reason: "the page no longer holds this line" }, a)
        if (done?.retired) retired += 1
      } catch {
        // Another writer changed it meanwhile: the next pass tries again.
      }
    }
    return retired
  }

  async function proposeMeetings(spaceId, { path = null, all = false } = {}) {
    if (!meetingMode) return { skipped: "off", proposed: 0 }
    if (!rawLlm?.available) return { skipped: "no_model", proposed: 0 }
    const a = jobsActor(spaceId)
    const sp = space(spaceId)
    // The list is cheap (bodies are cut): it is only a page's identity. The
    // full text and the version history are read for the pages this pass will
    // process, and for no others (0.11 review, nit).
    const listed = (await sp.list({ kind: "page", type: [MEETING_TYPE], status: "current", limit: 200 }, a)).records.filter((page) => !path || page.path === path)
    const pending = await readHandle(spaceId, a, (handle) => rows.meetingPendingPaths(handle))
    const marks = await readHandle(spaceId, a, (handle) => rows.meetingMarks(handle))
    const meta = await sp.meta()
    const eligible = listed.filter((page) => {
      const mark = marks.get(page.path)
      if (path) return !isLiveMeeting(page)
      // A live meeting is skipped: no call and no spend, and it keeps its mark
      // until a later save or tick finds it ended (opencode-mem#58).
      if (isLiveMeeting(page)) return false
      if (!pending.has(page.path) && !all) return false
      // A page that failed its attempts, or is in its back-off, waits without a
      // call; a person asking (`all`) still reads it.
      if (all) return true
      if (mark?.failed) return false
      if (mark?.failed_until && Date.parse(mark.failed_until) > nowMs()) return false
      return true
    })
    const selected = eligible.slice(0, meetingPagesPerPass)
    const more = eligible.length > selected.length
    const pages = selected.length === 0 ? [] : (await sp.get({ ids: selected.map((page) => page.id) }, a)).records
    const authors = pages.length === 0 ? new Map() : await readHandle(spaceId, a, (handle) => rows.meetingAuthors(handle, pages.map((page) => page.id)))
    const authorOf = (page) => authors.get(page.id) ?? {}
    const writerOf = (page) =>
      notesWriter(page, {
        personUser: meta.owner_user ?? null,
        spaceKind: meta.space_kind ?? null,
        writers: authorOf(page).writers ?? null,
        agents: authorOf(page).agents ?? null,
        complete: authorOf(page).complete ?? true,
      })
    // Only a page a save marked is read: a deploy never backfills the space's
    // old meetings (0.11 review, should-fix 3). A person asking (`all`) reads
    // every page whose text changed, or that never finished.
    const due = pages.filter((page) => {
      const mark = marks.get(page.path)
      if (path || all) return true
      if (!pending.has(page.path) || mark?.failed) return false
      if (mark?.failed_until && Date.parse(mark.failed_until) > nowMs()) return false
      // A part whose claim the gate held waits its pause, as a routine's hold does.
      return !(mark?.held_until && Date.parse(mark.held_until) > nowMs())
    })
    if (due.length === 0) {
      // A page that is read and unchanged stops being work. A page that failed,
      // or is backing off, keeps its pending row: it is still waiting.
      await jobTx(spaceId, a, (handle) => {
        for (const page of pages) {
          const mark = marks.get(page.path)
          // A live page keeps its pending row: it is waiting for the meeting to end.
          if (isLiveMeeting(page)) continue
          if (mark?.done && mark.digest === meetingDigest(page, writerOf(page))) rows.clearMeetingPending(handle, page.path)
        }
      })
      return { skipped: more ? "pages" : "clean", proposed: 0 }
    }

    const indexPage = await sp.get({ paths: ["index"] }, a).then((answer) => answer.records?.[0] ?? null)
    const tz = safeTz(indexPage?.fields?.tz ?? "UTC")
    const day = localDay(now(), tz)
    const shared = await modelGuard.usage(spaceId, { day, tz })
    let remaining = Math.min(meetingRunTokens, Math.max(0, modelGuard.limit - shared.used))
    if (remaining <= 0) return { skipped: "budget", proposed: 0 }
    // Asked after the budget, so a spent day says "budget" and not "breaker".
    if (modelGuard.openUntil(spaceId)) return { skipped: "breaker", proposed: 0 }

    const person = personFrom({
      user: meta.owner_user ?? null,
      label: indexPage?.fields?.name ?? "the person",
      sources: [],
      identities: indexPage?.fields?.identities ?? {},
      names: indexPage?.fields?.aliases ?? [],
    })
    const everything = (await sp.list({ kind: "page", limit: 200 }, a)).records
    const index = buildIndex({ people: everything.filter((page) => page.type === "person"), projects: everything.filter((page) => page.type === "project") })
    const commitments = new Map((await sp.list({ kind: "commitment", status: "all", limit: 200 }, a)).records.map((record) => [record.id, record]))
    const openCommitments = [...commitments.values()].filter((record) => (record.fields?.state ?? "open") === "open")

    let proposed = 0
    let duplicates = 0
    let forgotten = 0
    // A claim the gate held is retried, never counted as a rejection (§5.4).
    let traitHeld = 0
    let tokens = 0
    let calls = 0
    const rejected = {}
    const truncated = []
    let stopped = null
    let meetings = 0
    let left = false
    for (const page of due) {
      if (remaining <= 0) {
        stopped = "budget"
        left = true
        break
      }
      // A tick's work is bounded: the rest stay pending for the next one.
      if (meetings >= meetingPagesPerPass) {
        left = true
        break
      }
      const pageDay = meetingDayOf(page) ?? String(page.created ?? page.updated ?? nowIso()).slice(0, 10)
      const writer = writerOf(page)
      const digest = meetingDigest(page, writer)
      const mark = marks.get(page.path) ?? null
      // Resume where this text stopped last time: a part already sent is not
      // sent again (0.11 review, blocker 2). A changed page starts over.
      const fromPart = mark && mark.digest === digest ? Number(mark.parts) || 0 : 0
      // One gate per pass: the cell's trait breaker, the space's guard, and the
      // classifier's tokens charged to the run and so to the space's day.
      const gateFactory = ({ spent, budgetAt, onCall }) =>
        createTraitGate({
          llm: jobGateClient({
            llm: rawLlm,
            spent,
            budgetAt,
            breakerOpen: () => Boolean(modelGuard.openUntil(spaceId) || modelGuard.cellOpenUntil?.()),
            onCall: (used) => {
              onCall(used)
              calls += 1
            },
          }),
          breaker: traitBreakerOfCell(),
        })
      const run = await proposeFromMeeting({
        gateFactory,
        page,
        day: pageDay,
        person,
        index,
        commitments,
        openCommitments,
        llm: rawLlm,
        budget: remaining,
        limits: { maxNotes: 400, maxTranscriptLines: 600 },
        personUser: meta.owner_user ?? null,
        spaceKind: meta.space_kind ?? null,
        writers: authorOf(page).writers ?? null,
        agents: authorOf(page).agents ?? null,
        complete: authorOf(page).complete ?? true,
        parts: fromPart,
      })
      // A failed call is counted before it is reported: it spent a request.
      calls += run.calls
      tokens += run.tokens
      remaining -= run.tokens
      if (run.stopped === "model") {
        // **An outage is not the page's fault.** A refused connection, a 5xx or a
        // timeout counts toward the space's shared breaker and uses no attempt:
        // the page is tried again when the provider answers. A **content**
        // failure (bad JSON, a refusal, a failed validation) is the page's, so it
        // uses an attempt and never trips the breaker, which would also stop the
        // space's routines and jobs (0.11 review, blocker 4).
        if (endpointFailure(run.error)) {
          const breaker = modelGuard.fail(spaceId, run.error)
          await jobTx(spaceId, a, (handle) => {
            if (run.tokens > 0) rows.addMeetingSpend(handle, nowIso(), run.tokens)
            rows.pruneMeetingSpend(handle, iso(nowMs() - 40 * 86_400_000))
          })
          log?.warn?.({ event: "memory.job.meeting.endpoint", space: spaceId, meeting: page.path, breaker: breaker.opened ? iso(breaker.until) : null, error: errorText(String(run.error?.message ?? run.error), 200) })
          stopped = "model"
          left = true
          break
        }
        const sameText = mark && mark.digest === digest
        const failures = (sameText ? Number(mark.failures) || 0 : 0) + 1
        const failed = failures >= meetingPartAttempts
        const failedUntil = failed ? null : iso(nowMs() + meetingPartBackoffMs[Math.min(failures, meetingPartBackoffMs.length) - 1])
        await jobTx(spaceId, a, (handle) => {
          rows.setMeetingMark(handle, { path: page.path, id: page.id, digest, proposed: 0, tokens: run.tokens, truncated: run.truncated, parts: fromPart, partsTotal: run.partsTotal, done: false, failures, failedUntil, failed, updated: nowIso() })
          if (failed) rows.clearMeetingPending(handle, page.path)
          if (run.tokens > 0) rows.addMeetingSpend(handle, nowIso(), run.tokens)
          rows.pruneMeetingSpend(handle, iso(nowMs() - 40 * 86_400_000))
        })
        log?.warn?.({ event: "memory.job.meeting.failed", space: spaceId, meeting: page.path, attempts: failures, failed, error: errorText(String(run.error?.message ?? run.error), 200) })
        stopped = "model"
        left = true
        break
      }
      modelGuard.ok(spaceId)
      traitHeld += Number(run.held) || 0
      for (const [reason, count] of Object.entries(run.rejected)) rejected[reason] = (rejected[reason] ?? 0) + count
      for (const notice of run.truncated) truncated.push(`${page.path}: ${notice}`)
      const written = run.proposals.length ? await writeMeetingProposals(sp, a, page.id, run.proposals) : { written: [], duplicates: 0, forgotten: 0, refused: [] }
      proposed += written.written.length
      duplicates += written.duplicates
      forgotten += written.forgotten
      meetings += 1
      // Every part read: the page is finished and stops being work. A run that
      // stopped keeps the parts it did read and stays pending.
      const complete = !run.stopped && run.parts >= run.partsTotal
      // A held claim is retried on the hold's own pause (1 to 24 hours), so a
      // down classifier does not re-read the page on every tick (design §5.4).
      const heldCount = Number(run.held) || 0
      const sameDigest = Boolean(mark && mark.digest === digest)
      const heldAttempts = heldCount > 0 ? (sameDigest ? Number(mark.held_attempts) || 0 : 0) + 1 : 0
      const heldUntil = heldCount > 0 ? iso(nowMs() + HOLD_BACKOFF_HOURS[Math.min(heldAttempts - 1, HOLD_BACKOFF_HOURS.length - 1)] * 3_600_000) : null
      await jobTx(spaceId, a, (handle) => {
        rows.setMeetingMark(handle, { path: page.path, id: page.id, digest, proposed: written.written.length, tokens: run.tokens, truncated: run.truncated, parts: run.parts, partsTotal: run.partsTotal, done: complete, heldUntil, heldAttempts, updated: nowIso() })
        if (complete) rows.clearMeetingPending(handle, page.path)
        if (run.tokens > 0) rows.addMeetingSpend(handle, nowIso(), run.tokens)
        rows.pruneMeetingSpend(handle, iso(nowMs() - 40 * 86_400_000))
      })
      // A line the page no longer holds takes its waiting proposal with it
      // (0.11 review, should-fix 2): retirement scrubs the quote, and an
      // accepted proposal is left exactly as it is.
      let editedOut = 0
      if (complete) editedOut = await retireEditedOut(sp, a, page, written.written)
      log?.info?.({ event: "memory.job.meeting", space: spaceId, meeting: page.path, proposed: written.written.length, duplicates: written.duplicates, tokens: run.tokens, calls: run.calls, written_by: writer.kind, parts: `${run.parts}/${run.partsTotal}`, truncated: run.truncated.length, edited_out: editedOut })
      if (!complete) {
        stopped = run.stopped ?? "parts"
        left = true
        break
      }
    }
    if (left) log?.info?.({ event: "memory.job.meeting.left", space: spaceId, stopped })
    return { proposed, meetings, duplicates, forgotten, tokens, calls, rejected, truncated, ...(traitHeld ? { traits_held: traitHeld } : {}), ...(left || more ? { stopped: stopped ?? "pages" } : {}) }
  }

  /**
   * The person's or a console's own pass: the same engine the tick runs, for one
   * space (and one page, when it names one). It proposes; it never applies.
   */
  async function meetings(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Proposing from a meeting page needs the space's owner")
    const path = typeof body?.path === "string" ? body.path : null
    // A person asking reads every page whose text changed, old ones included:
    // that is the only way a deploy backfills (should-fix 3).
    await retireGoneMeetings(spaceId)
    const done = await proposeMeetings(spaceId, { path, all: true })
    // The space's index entry follows the pass, so a page still waiting for
    // budget is opened again and one already read is not.
    await jobTx(spaceId, a, () => {})
    dirtyMeetings.delete(spaceId)
    return done
  }

  /**
   * An **endpoint** failure: no answer at all (a refused connection or a
   * timeout), a 5xx, or a rate limit. The page is not at fault; the provider is.
   */
  const endpointFailure = (error) => {
    const status = Number(error?.status) || 0
    // A refused connection, a timeout, a 5xx, a rate limit — and **an auth
    // refusal**: a bad or rotated key is the provider's door, not the page's, and
    // must not fail every waiting page until each is saved again (401, 403, 404).
    return status === 0 || status === 401 || status === 403 || status === 404 || status === 429 || status >= 500
  }

  /** A project link the job would need, proposed rather than written (§6.2). */
  function projectLinkOf(job, run, index, stage) {
    if (!outputsOf(job, stage).has("proposal:link")) return null
    const channels = Array.isArray(parseJson(JSON.stringify(job.scope ?? {}), {})?.channels) ? job.scope.channels : []
    if (job.source !== "slack" || channels.length === 0) return null
    const project = index.projects.find((page) => page.path === job.page)
    if (!project || Array.isArray(project.fields?.slack_channels) && project.fields.slack_channels.includes(channels[0])) return null
    return projectLinkProposal({ job, run, index, projectPath: project.path, field: "slack_channels", values: channels })
  }

  /**
   * What the job would have written into a block the person has taken over:
   * one `append` proposal for the page, so the line arrives through review and
   * never by overwriting them (P2, §6.2).
   */
  async function propose(spaceId, a, { job, run, lines, event = null }) {
    const record = {
      kind: "proposal",
      type: "append",
      title: `${job.name}: ${lines.length} line(s) for ${job.page}`.slice(0, 200),
      body: JSON.stringify({ path: job.page, section: "Log", text: lines.join("\n") }),
      fields: { target_path: job.page, action: "append", reason: "the block holds your edit, so the job proposes its lines instead", job: job.id, run: run.id },
      stated_by: "external",
      ...(event ? { source: { event } } : {}),
    }
    const saved = await space(spaceId).put({ record }, a)
    return saved?.record ?? null
  }

  const markCurated = (spaceId, a, jobId, runId, wrote = null) =>
    jobTx(spaceId, a, (handle) => {
      rows.markRunCurated(handle, runId, nowIso())
      rows.markItemsCurated(handle, jobId)
      if (wrote) rows.setLensHash(handle, jobId, wrote, runId, nowIso())
    })

  /** The project a job's page belongs to: the last segment of `projects/<slug>`. */
  const pageTitleOf = (job) => String(job.page ?? "").split("/").pop()

  // -------------------------------------------------------------------------
  // The schedule (§4.1)

  /**
   * One tick: fail runs a restart left behind, make due jobs' runs (one per job,
   * waiting for a host), and curate finished runs over what was stored.
   *
   * **It opens only the spaces with work** (0.11): the index says which have a
   * due job, a running row that may have gone stale, or a run to curate, so a
   * thousand spaces with three due jobs cost three file opens a minute rather
   * than a thousand.
   */
  async function tick(spaceId) {
    if (!spaceId && ticking) return ticking
    const run = (async () => {
      const ids = spaceId ? [spaceId] : [...new Set([...(await workSpaces()), ...dirtyMeetings])].sort()
      const total = { spaces: 0, queued: 0, recovered: 0, curated: 0, meetings: 0, proposed: 0 }
      for (const id of ids) {
        const a = jobsActor(id)
        total.spaces += 1
        const at = nowMs()
        const stale = await jobTx(id, a, (handle) => {
          const nowIso = iso(at)
          const count = { queued: 0, recovered: 0 }
          for (const row of rows.runningRuns(handle)) {
            const started = Date.parse(row.started ?? "")
            if (Number.isFinite(started) && at - started < staleMs) continue
            const job = rows.jobRow(handle, row.job_id)
            rows.endRun(handle, row.id, { status: "failed", outcome: "failed", error: "the run outlived its lease (a restart or a crash)", finished: nowIso })
            rows.log(handle, row.id, nowIso, "error", "job.stale", "marked failed after its lease")
            if (!job) continue
            const failures = Number(job.failures) + 1
            rows.setJobFailures(handle, job.id, failures, "the last run did not finish", nowIso)
            if (failures >= BREAKER_FAILURES) rows.setJobStatus(handle, job.id, "paused", `${failures} failed runs in a row`, nowIso)
            else rows.setJobDue(handle, job.id, nextDue(at, { every: job.every_ms, failures }), nowIso)
            count.recovered += 1
          }
          for (const job of rows.activeJobsDue(handle, nowIso)) {
            if (rows.openRunForJob(handle, job.id)) continue
            const fresh = freshRun(job, nowIso)
            rows.insertRun(handle, fresh)
            rows.setJobDue(handle, job.id, nextDue(at, { every: job.every_ms, failures: job.failures }), nowIso)
            rows.log(handle, fresh.id, nowIso, "info", "job.due", "waiting for a host")
            count.queued += 1
          }
          return count
        })
        total.recovered += stale.recovered
        total.queued += stale.queued
        const pending = await readHandle(id, a, (handle) => rows.uncuratedRuns(handle).map((row) => row.id))
        for (const runId of pending) {
          try {
            const done = await curate(id, { run_id: runId }, a)
            if (done.curated) total.curated += 1
          } catch (error) {
            log?.warn?.({ event: "memory.job.curate.failed", run: runId, error: errorText(String(error?.message ?? error), 200) })
          }
        }
        // A meeting page written since the last pass: proposals only, and the
        // space leaves the queue whatever the engine answered (a spent day is
        // not retried on every tick; the next save asks again).
        if (dirtyMeetings.has(id) || Number(schedule.get(id)?.meetings) > 0) {
          try {
            // Withdrawing a deleted page's proposals is not behind the switch
            // (0.11 re-review): it runs whether proposals are on or off.
            const retired = await retireGoneMeetings(id)
            total.retired = (total.retired ?? 0) + retired.retired
            if (meetingMode) {
              const done = await proposeMeetings(id)
              total.meetings += done.meetings ?? 0
              total.proposed += done.proposed ?? 0
              if (done.stopped) total.stopped = done.stopped
            }
          } catch (error) {
            log?.warn?.({ event: "memory.job.meeting.error", space: id, error: errorText(String(error?.message ?? error), 200) })
          }
          dirtyMeetings.delete(id)
        }
      }
      return total
    })()
    if (!spaceId) {
      ticking = run.finally(() => {
        ticking = null
      })
      return ticking
    }
    return run
  }

  /** Run now: a job's next due time is now, so the next claim or tick takes it. */
  async function runNow(spaceId, body, actor) {
    const a = system(spaceId, actor)
    requireRole(a, "owner", "Running a job now needs the space's owner")
    const job = await jobTx(spaceId, a, (handle) => {
      const current = typeof body?.job_id === "string" ? rows.jobRow(handle, body.job_id) : rows.jobRows(handle)[0]
      if (!current) throw notFound("No job to run.", "Make one from a template first.")
      // A draft is never run by any door (§5.5): not by the host, and not by a
      // manual run, which would otherwise turn it active without a consent.
      if (current.status === "draft") throw conflict("job_draft", `Job ${current.id} is a draft: only the person can confirm it, and a draft never runs.`, "Confirm it in Memory's console, Jobs.")
      // Running a job now is not a way past its consent: the same check the
      // claim makes decides here, so a job with no consent, or one whose
      // consent no longer holds, is not quietly turned back on by a manual run.
      const problem = jobProblem(handle, current)
      if (problem) throw conflict(problem.code, problem.message, problem.next)
      if (current.status === "paused" || current.status === "archived") throw conflict("job_not_active", `Job ${current.id} is ${current.status}.`, "Turn the job back on first.")
      rows.setJobDue(handle, current.id, iso(nowMs()), nowIso())
      rows.setJobStatus(handle, current.id, "active", null, nowIso())
      return rows.pubJob(rows.jobRow(handle, current.id))
    })
    const queued = await tick(spaceId)
    return { job, ...queued }
  }

  function start() {
    if (timer) return
    const every = Number.isFinite(config.tickMs) ? config.tickMs : TICK_MS
    timer = setInterval(() => {
      tick().catch((error) => log?.error?.({ event: "memory.job.tick", error: errorText(String(error?.message ?? error), 200) }))
    }, every)
    timer.unref?.()
  }

  function stop() {
    if (timer) clearInterval(timer)
    timer = null
  }

  return {
    schema: JOBS_SCHEMA,
    template,
    create,
    draft,
    list,
    get,
    versions,
    diff,
    runs,
    logs,
    items,
    hosts,
    report,
    request,
    probe,
    consent,
    activate,
    pause: pauseJob,
    resume,
    archive,
    remove,
    claim,
    checkpoint,
    finish,
    curate,
    tick,
    runNow,
    meetings,
    start,
    stop,
  }
}

// ---------------------------------------------------------------------------
// Small helpers

function keyOf(raw) {
  if (!raw || typeof raw !== "object") return null
  const id = raw.external_id
  return typeof id === "string" ? id.slice(0, 100) : typeof id === "number" ? String(id) : null
}

const dbRefusal = (externalId, reason) => ({ external_id: externalId === null || externalId === undefined ? null : String(externalId).slice(0, 100), reason: String(reason).slice(0, 200) })

function isCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false
  return Object.keys(value).every((key) => ["accepted", "duplicates", "withdrawn", "refused", "tool_calls", "pages", "tokens", "proposals"].includes(key) && Number.isFinite(Number(value[key])))
}

function addCounts(base = {}, add = {}) {
  const out = { ...base }
  for (const key of ["accepted", "duplicates", "withdrawn", "refused", "tool_calls", "pages", "tokens", "proposals"]) {
    const value = Number(add[key] ?? 0)
    if (value) out[key] = Number(out[key] ?? 0) + value
  }
  return out
}

/** v0.1.0's set (source-contract D4): the two reasons the contract's `gap` admits. Contract 2's older
 * `sync-token-expired` and `cursor-invalid` are gone: an invalid cursor is an error, not a gap. */
const GAP_REASONS = ["expired", "window-truncated"]
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/
const GAP_MAX_DAYS = 31

/**
 * §9.3: the `gap` a source answers with when it restarted its window, judged on
 * arrival. The contract's shape is `{ reason, since }` with one of v0.1.0's two
 * reasons; an answer that is not that shape is refused, so a plugin cannot
 * restart a window with a `since` that reaches years back or a reason the
 * contract does not define.
 *
 * @returns {{reason: string, since: string} | null}
 */
function readGap(value, at) {
  if (value === undefined || value === null) return null
  const refuse = (why) => {
    throw invalid("gap_refused", `The page says its source restarted its window, but ${why}.`, "Update the plugin: a gap is { reason, since }, with reason expired or window-truncated and ISO 8601 UTC times, and a since no more than 31 days back.")
  }
  if (typeof value !== "object" || Array.isArray(value)) refuse("it is not an object")
  const extra = Object.keys(value).filter((key) => key !== "reason" && key !== "since")
  if (extra.length > 0) refuse(`it carries ${extra.join(", ")}, and the contract's gap is { reason, since }`)
  const reason = String(value.reason ?? "")
  if (!GAP_REASONS.includes(reason)) refuse(`its reason is not one of ${GAP_REASONS.join(", ")}`)
  const since = String(value.since ?? "")
  if (!ISO_UTC.test(since) || Number.isNaN(Date.parse(since))) refuse("its since is not an ISO 8601 UTC time")
  if (at - Date.parse(since) > GAP_MAX_DAYS * 86_400_000) refuse(`its since is more than ${GAP_MAX_DAYS} days back`)
  return { reason, since }
}

/** True when every id is one the person confirmed for that scope key, and there is at least one. */
function allowedScope(ids, confirmed) {
  if (!Array.isArray(ids) || ids.length === 0) return true
  if (!Array.isArray(confirmed)) return false
  return ids.every((id) => confirmed.includes(id))
}

const grantKey = (grant) => `${grant?.action}\u0000${grant?.resource}`
const intersectGrants = (consented, live) => {
  const keys = new Set((Array.isArray(live) ? live : []).map(grantKey))
  return new Set((Array.isArray(consented) ? consented : []).map(grantKey).filter((key) => keys.has(key)))
}

function sameFields(a, b) {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})
}

/**
 * True when an answer's scope echo is inside the job's confirmed scope. A job
 * with no confirmed scope key confirmed the whole source (contract 2's `{}`),
 * so the echo is inside it; a job that names a key is held to it, id by id.
 */
function scopeWithin(echo, confirmed) {
  const keys = Object.keys(confirmed ?? {})
  if (keys.length === 0) return true
  if (!echo || typeof echo !== "object") return false
  return Object.entries(echo).every(([key, ids]) => Array.isArray(confirmed[key]) && Array.isArray(ids) && ids.every((id) => confirmed[key].includes(id)))
}

/** One stored event, as `events.ingest` stores it: by id, hash-compared. */
function storeEvent(handle, source, account, event, id, nowIso) {
  const existing = handle.get("select hash, removed_at from events where id = ?", id)
  // The OpenCode session the event names, so the curate reader can skip a
  // session capture owns (B8). The field, never the text.
  // Only History's own events name a session: the binding's package is the gate.
  const session = sessionIdOf(event, handle.get("select package_name from plugin_consents where source = ? and account = ?", source, account)?.package_name)
  if (existing && existing.hash === event.hash) return
  if (existing) {
    // A row a removal or a tombstone already cleared keeps its empty title,
    // text, url and meta: a later read of the same item updates the row's
    // identity, never its content. The page write (`events.ingest`) is the one
    // path that may put words back (0.11's "put back"), and it says so.
    if (existing.removed_at) {
      handle.run("update events set kind = ?, occurred_at = ?, thread = ?, actors = ?, labels = ?, hash = ?, ingested_at = ?, session_id = coalesce(?, session_id) where id = ?", event.kind, event.occurred_at, event.thread, JSON.stringify(event.actors), JSON.stringify(event.labels), event.hash, nowIso, session, id)
      return
    }
    handle.run("update events set kind = ?, occurred_at = ?, thread = ?, actors = ?, title = ?, text = ?, url = ?, labels = ?, hash = ?, ingested_at = ?, session_id = coalesce(?, session_id), meta = ? where id = ?", event.kind, event.occurred_at, event.thread, JSON.stringify(event.actors), event.title, event.text, event.url, JSON.stringify(event.labels), event.hash, nowIso, session, event.meta === undefined ? null : JSON.stringify(event.meta), id)
    return
  }
  handle.run(
    `insert into events (id, source, account, external_id, kind, occurred_at, thread, actors, title, text, url, labels, hash, ingested_at, session_id, meta)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    source,
    account,
    event.external_id,
    event.kind,
    event.occurred_at,
    event.thread,
    JSON.stringify(event.actors),
    event.title,
    event.text,
    event.url,
    JSON.stringify(event.labels),
    event.hash,
    nowIso,
    session,
    event.meta === undefined ? null : JSON.stringify(event.meta),
  )
}

/**
 * The sessions capture owns in this space (DESIGN §15.1, B8): their convention
 * is curated from the L0 turns, so nothing a job staged for them is read again.
 */
function capturedSessions(handle) {
  return new Set(handle.all("select session_id from sessions_seen where first_side = 'capture'").map((row) => row.session_id))
}

/**
 * A job's items, with the stored event's text and actors, for the block and for
 * extract. An event whose session capture owns is left out: that session is
 * curated once, from capture, and this is a read-time skip — nothing is deleted
 * and the transcript stays (B8).
 */
function itemsFor(handle, jobId) {
  const captured = capturedSessions(handle)
  return handle
    .all(
      `select i.event_id, i.external_id, i.occurred_at, c.curated, e.source, e.account, e.kind, e.thread, e.session_id, e.labels, e.title, e.text, e.actors, e.url
         from job_curation c
         join job_items i on i.connector = c.connector and i.account = c.account and i.external_id = c.external_id
         join events e on e.id = i.event_id
        where c.job_id = ? order by i.occurred_at, i.external_id`,
      jobId,
    )
    .filter((row) => !(row.session_id && captured.has(row.session_id)))
    .map((row) => ({ ...row, actors: parseJson(row.actors, []), labels: parseJson(row.labels, []) }))
}

/** How many of a job's staged events a capture-owned session leaves to capture: counted, never curated. */
function sessionsSkipped(handle, jobId) {
  const captured = capturedSessions(handle)
  if (captured.size === 0) return 0
  return handle
    .all(
      `select e.session_id from job_curation c
         join job_items i on i.connector = c.connector and i.account = c.account and i.external_id = c.external_id
         join events e on e.id = i.event_id
        where c.job_id = ? and e.session_id is not null`,
      jobId,
    )
    .filter((row) => captured.has(row.session_id)).length
}

const parseJson = (text, fallback) => {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

/** The same id `events.ingest` mints (ids.js `eventId`): one key, one event. */
const eventIdOf = (source, account, externalId) => eventId(source, account, externalId)
