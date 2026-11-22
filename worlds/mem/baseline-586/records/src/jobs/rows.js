/**
 * The job tables, as rows over one space's handle (records/src/jobs/schema.js).
 *
 * Every function here takes the space's `Handle` and does no transaction of its
 * own: the caller (records/src/jobs/index.js) opens one per call, so a
 * checkpoint writes its items and its cursor together (DESIGN-MEMORY-JOBS §4.2).
 */
import { createHash } from "node:crypto"
import { errorText } from "../text.js"


const parse = (text, fallback) => {
  if (text === null || text === undefined) return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

const json = (value) => JSON.stringify(value ?? null)

/** A job row as the console and the host read it: JSON columns parsed, no collected text. */
/** The digest of a job's state as a preview shows it: what a G2 commit must carry (DESIGN-CRUD §3.2). */
export function stateDigest(row) {
  if (!row) return null
  return createHash("sha256").update(JSON.stringify([row.id, row.version, row.status, row.updated, row.next_due ?? null])).digest("hex").slice(0, 32)
}

export function pubJob(row) {
  if (!row) return null
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    version: row.version,
    template: row.template,
    connector: row.connector,
    source: row.source,
    account: row.account,
    owner: { id: row.owner_id, label: row.owner_label ?? row.owner_id },
    scope: parse(row.scope, {}),
    kinds: parse(row.kinds, []),
    grants: parse(row.grants, []),
    page: row.page,
    stage: row.stage,
    digest: row.digest,
    every_ms: row.every_ms,
    extract: parse(row.extract, []),
    transform: parse(row.transform, {}),
    curate: parse(row.curate, []),
    outputs: parse(row.outputs, []),
    budgets: parse(row.budgets, {}),
    cursor: row.cursor ?? null,
    cursor_at: row.cursor_at ?? null,
    next_due: row.next_due ?? null,
    failures: row.failures,
    // The job's own reason can quote a paused binding's words ("… is paused: <reason>"): redacted as it
    // is answered, so an old row cannot show a secret through the console (0.11 review, Check 2).
    reason: row.reason === null || row.reason === undefined ? null : errorText(row.reason, 300),
    created: row.created,
    updated: row.updated,
    state_digest: stateDigest(row),
  }
}

export function pubRun(row) {
  if (!row) return null
  return {
    id: row.id,
    job_id: row.job_id,
    version: row.version,
    digest: row.digest,
    status: row.status,
    lease_host: row.lease_host ?? null,
    lease_epoch: row.lease_epoch,
    lease_expires: row.lease_expires ?? null,
    cursor_before: row.cursor_before ?? null,
    cursor_after: row.cursor_after ?? null,
    counts: parse(row.counts, {}),
    // A row written before 0.11's fix holds the page's own words raw: they are
    // redacted where they are answered, so an old row cannot show a secret
    // (0.11 review B1, "redact on read").
    refusals: parse(row.refusals, []).map((entry) => (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.reason === "string" ? { ...entry, reason: errorText(entry.reason, 100) } : entry)),
    outcome: row.outcome ?? null,
    error: row.error === null || row.error === undefined ? null : errorText(row.error, 300),
    started: row.started,
    finished: row.finished ?? null,
    curated: row.curated ?? null,
  }
}

export const insertJob = (handle, job) =>
  handle.run(
    `insert into jobs (id, name, status, version, template, connector, source, account, owner_id, owner_label, scope, kinds, grants, page, stage, digest, every_ms, extract, transform, curate, outputs, budgets, cursor, cursor_at, next_due, failures, reason, created, updated)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, null, ?, ?)`,
    job.id,
    job.name,
    job.status,
    job.version,
    job.template,
    job.connector,
    job.source,
    job.account,
    job.owner.id,
    job.owner.label ?? null,
    json(job.scope),
    json(job.kinds),
    json(job.grants),
    job.page,
    job.stage,
    job.digest,
    job.every_ms,
    json(job.extract),
    json(job.transform),
    json(job.curate),
    json(job.outputs),
    json(job.budgets),
    null,
    null,
    job.next_due,
    job.created,
    job.updated,
  )

export const jobRow = (handle, id) => handle.get("select * from jobs where id = ?", id)
export const jobRows = (handle) => handle.all("select * from jobs order by created, id")
export const activeJobsDue = (handle, nowIso) => handle.all("select * from jobs where status = 'active' and (next_due is null or next_due <= ?) order by next_due, id", nowIso)

export const setJobDue = (handle, id, nextDue, nowIso) => handle.run("update jobs set next_due = ?, updated = ? where id = ?", nextDue, nowIso, id)

export const setJobCursor = (handle, id, cursor, nowIso) =>
  handle.run("update jobs set cursor = ?, cursor_at = ?, updated = ? where id = ?", cursor, nowIso, nowIso, id)

export const setJobFailures = (handle, id, failures, reason, nowIso) =>
  handle.run("update jobs set failures = ?, reason = ?, updated = ? where id = ?", failures, reason, nowIso, id)

export const setJobStatus = (handle, id, status, reason, nowIso) =>
  handle.run("update jobs set status = ?, reason = ?, updated = ? where id = ?", status, reason, nowIso, id)

export const insertRun = (handle, run) =>
  handle.run(
    `insert into job_runs (id, job_id, version, digest, status, lease_host, lease_epoch, lease_expires, cursor_before, cursor_after, counts, refusals, outcome, error, started, finished, curated)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, ?, null, null)`,
    run.id,
    run.job_id,
    run.version,
    run.digest,
    run.status,
    run.lease_host ?? null,
    run.lease_epoch ?? 0,
    run.lease_expires ?? null,
    run.cursor_before ?? "",
    run.cursor_after ?? null,
    json(run.counts ?? {}),
    json(run.refusals ?? []),
    run.started,
  )

export const runRow = (handle, id) => handle.get("select * from job_runs where id = ?", id)
export const runRows = (handle, jobId, limit = 20) =>
  jobId
    ? handle.all("select * from job_runs where job_id = ? order by started desc, id desc limit ?", jobId, limit)
    : handle.all("select * from job_runs order by started desc, id desc limit ?", limit)
export const runningRuns = (handle) => handle.all("select * from job_runs where status = 'running' order by started, id")
/**
 * The oldest queued run of an active job. With `allow` (a connector predicate,
 * see `abilityOf`) it is the first one **in the same order** whose job's
 * connector the host may serve, so an unmatched run at the head blocks nobody.
 * Without it, today's query exactly.
 */
export const queuedRun = (handle, allow = null) =>
  allow === null
    ? handle.get("select r.* from job_runs r join jobs j on j.id = r.job_id where r.status = 'queued' and j.status = 'active' order by r.started, r.id limit 1")
    : handle.all("select r.*, j.connector as job_connector from job_runs r join jobs j on j.id = r.job_id where r.status = 'queued' and j.status = 'active' order by r.started, r.id").find((row) => allow(row.job_connector))
export const openRunForJob = (handle, jobId) =>
  handle.get("select * from job_runs where job_id = ? and status in ('queued', 'running') order by started, id limit 1", jobId)

/**
 * The earliest time a run becomes claimable for this space's hosts, or null
 * when nothing is scheduled (POLLING §5 cut 2). A host sleeps until this time
 * instead of asking every minute.
 *
 * Two things can make a run claimable: an active job with no open run, at its
 * own `next_due` (a job with none is due now, as `activeJobsDue` reads it), and
 * a live lease, when it expires and its run can be claimed again. Both are ISO
 * strings from the same clock, so text order is time order.
 */
export function nextClaimable(handle, nowIso, allow = null) {
  let earliest = null
  const consider = (at) => {
    if (typeof at === "string" && (earliest === null || at < earliest)) earliest = at
  }
  // With `allow`, only the runs this host may serve count (lane 0189): a host
  // that has no matching job must not see a past time and retry every 30 s.
  for (const row of handle.all(
    `select coalesce(j.next_due, ?) as at, j.connector as connector
       from jobs j
      where j.status = 'active'
        and not exists (select 1 from job_runs r where r.job_id = j.id and r.status in ('queued', 'running'))`,
    nowIso,
  )) if (allow === null || allow(row.connector)) consider(row.at)
  for (const row of handle.all("select r.lease_expires as lease_expires, j.connector as connector from job_runs r left join jobs j on j.id = r.job_id where r.status = 'running' and r.lease_expires > ?", nowIso)) {
    if (allow === null || allow(row.connector)) consider(row.lease_expires)
  }
  return earliest
}

/**
 * A consent probe waits: a request the person made, with a draft to read it in
 * (POLLING §5 cut 2). With `allow`, only a probe for a connector this host may
 * serve: the draft's own connector, which is what the host reads it with.
 */
export function probePending(handle, allow = null) {
  return handle.all("select job_id from job_requests where state = 'requested'").some((request) => {
    const draft = draftRow(handle, request.job_id)
    if (!draft) return false
    if (allow === null) return true
    const connector = parse(draft.doc, null)?.connector ?? jobRow(handle, request.job_id)?.connector
    return allow(connector)
  })
}

export const uncuratedRuns = (handle) =>
  handle.all("select * from job_runs where status in ('ok', 'failed') and curated is null order by started, id")

/**
 * The work a space holds right now, for the scheduler's index (0.11): three
 * numbers, never a job's own rows, so a tick decides which spaces to open
 * without opening them. `due` is when the earliest active job is next due (0
 * when one has no due time: it is due now, as `activeJobsDue` reads it);
 * `staleAt` is when the earliest `running` row's lease is stale, and 0 for a
 * row with no readable start, which only a restart leaves; `uncurated` counts
 * the finished runs waiting for curate.
 */
export function workOf(handle, staleMs = 0) {
  // A job that already has a queued or running run is not work the tick can do:
  // `openRunForJob` skips it, so its due time must not keep the space opened.
  const active = handle.get(
    `select count(*) as n, sum(case when j.next_due is null then 1 else 0 end) as undated, min(j.next_due) as next
       from jobs j
      where j.status = 'active'
        and not exists (select 1 from job_runs r where r.job_id = j.id and r.status in ('queued', 'running'))`,
  )
  const count = Number(active?.n) || 0
  const undated = Number(active?.undated) || 0
  const next = active?.next ? Date.parse(active.next) : NaN
  const due = count === 0 ? Infinity : undated > 0 || !Number.isFinite(next) ? 0 : next
  let staleAt = Infinity
  for (const row of handle.all("select started from job_runs where status = 'running'")) {
    const started = Date.parse(row.started ?? "")
    staleAt = Math.min(staleAt, Number.isFinite(started) ? started + staleMs : 0)
  }
  const uncurated = Number(handle.get("select count(*) as n from job_runs where status in ('ok', 'failed') and curated is null")?.n) || 0
  // A meeting page saved since its last proposal pass (0.11): durable, so a
  // restart's first scan finds it without opening a space for nothing.
  const meetings = Number(handle.get("select count(*) as n from meeting_pending")?.n) || 0
  return { due, staleAt, uncurated, meetings }
}

export const leaseRun = (handle, id, { host, epoch, expires, started }) =>
  handle.run(
    "update job_runs set status = 'running', lease_host = ?, lease_epoch = ?, lease_expires = ?, started = coalesce(started, ?) where id = ?",
    host,
    epoch,
    expires,
    started,
    id,
  )

export const renewLease = (handle, id, expires) => handle.run("update job_runs set lease_expires = ? where id = ?", expires, id)

export const setRunCounts = (handle, id, counts, refusals, cursorAfter) =>
  handle.run(
    "update job_runs set counts = ?, refusals = ?, cursor_after = coalesce(?, cursor_after) where id = ?",
    json(counts),
    json(refusals),
    cursorAfter ?? null,
    id,
  )

export const endRun = (handle, id, { status, outcome, error, finished }) =>
  handle.run("update job_runs set status = ?, outcome = ?, error = ?, finished = ?, lease_expires = null where id = ?", status, outcome, error ?? null, finished, id)

export const markRunCurated = (handle, id, at) => handle.run("update job_runs set curated = ? where id = ?", at, id)

/** A job's items with its own curate state: the block's source of truth. */
export const itemRows = (handle, jobId) =>
  handle.all(
    `select i.connector, i.account, i.external_id, i.event_id, c.run_id, i.occurred_at, c.curated
       from job_curation c join job_items i on i.connector = c.connector and i.account = c.account and i.external_id = c.external_id
      where c.job_id = ? order by i.occurred_at, i.external_id`,
    jobId,
  )

/** The stored event of one item key: global, whoever stored it first. */
export const itemKey = (handle, connector, account, externalId) =>
  handle.get("select event_id from job_items where connector = ? and account = ? and external_id = ?", connector, account, externalId)

/** This job's curate state for one key: present once the job has staged it. */
export const curateKey = (handle, jobId, connector, account, externalId) =>
  handle.get("select curated from job_curation where job_id = ? and connector = ? and account = ? and external_id = ?", jobId, connector, account, externalId)

/** Store the item once, whichever job read it first (§4.2: one key, one row). */
export const insertItem = (handle, item) =>
  handle.run(
    "insert into job_items (connector, account, external_id, event_id, job_id, run_id, occurred_at, stored) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict(connector, account, external_id) do nothing",
    item.connector,
    item.account,
    item.external_id,
    item.event_id,
    item.job_id,
    item.run_id,
    item.occurred_at,
    item.stored,
  )

/** This job's curate state over the item, separate from every other job's. */
export const insertCuration = (handle, item) =>
  handle.run(
    "insert into job_curation (job_id, connector, account, external_id, run_id, curated) values (?, ?, ?, ?, ?, 0) on conflict(job_id, connector, account, external_id) do nothing",
    item.job_id,
    item.connector,
    item.account,
    item.external_id,
    item.run_id,
  )

/** The block holds every item this job has staged. */
export const markItemsCurated = (handle, jobId) => handle.run("update job_curation set curated = 1 where job_id = ? and curated = 0", jobId)

/** A cancellation: the item the source listed again, withdrawn rather than kept (§6.2). */
export const withdraw = (handle, item) =>
  handle.run(
    "insert into job_withdrawals (job_id, connector, account, external_id, run_id, at) values (?, ?, ?, ?, ?, ?) on conflict(job_id, connector, account, external_id) do update set run_id = excluded.run_id, at = excluded.at",
    item.job_id,
    item.connector,
    item.account,
    item.external_id,
    item.run_id,
    item.at,
  )

/** Every external id this job has withdrawn. */
export const withdrawnIds = (handle, jobId) => new Set(handle.all("select connector, account, external_id from job_withdrawals where job_id = ?", jobId).map((row) => `${row.connector}\u0000${row.account}\u0000${row.external_id}`))

/** The resync a binding already made today, if any (§9.3: one a day, per binding). */
export const resyncOf = (handle, source, account, day) =>
  handle.get("select * from binding_resyncs where source = ? and account = ? and day = ?", source, account, day) ?? null

export const setResync = (handle, { source, account, day, job_id, run_id, reason, since, at }) =>
  handle.run(
    "insert into binding_resyncs (source, account, day, job_id, run_id, reason, since, at) values (?, ?, ?, ?, ?, ?, ?, ?) on conflict(source, account, day) do update set job_id = excluded.job_id, run_id = excluded.run_id, reason = excluded.reason, since = excluded.since, at = excluded.at",
    source,
    account,
    day,
    job_id,
    run_id,
    reason,
    since ?? null,
    at,
  )

export const lensHashOf = (handle, jobId) => handle.get("select hash from job_lens where job_id = ?", jobId)?.hash ?? null

export const setLensHash = (handle, jobId, hash, runId, nowIso) =>
  handle.run(
    "insert into job_lens (job_id, hash, run_id, updated) values (?, ?, ?, ?) on conflict(job_id) do update set hash = excluded.hash, run_id = excluded.run_id, updated = excluded.updated",
    jobId,
    hash,
    runId ?? null,
    nowIso,
  )

// ---------------------------------------------------------------------------
// Meeting pages (0.11, opencode-mem#58 item 2): what each page proposed from.

/** Every meeting page's mark, keyed by path. */
export const meetingMarks = (handle) =>
  new Map(handle.all("select path, record_id, digest, proposed, truncated, parts, parts_total, done, failures, failed_until, failed, held_until, held_attempts, updated from meeting_proposals").map((row) => [row.path, row]))

/** Record how far a page's text has been read, and how many proposals it made. */
export const setMeetingMark = (handle, { path, id, digest, proposed, tokens, truncated, parts, partsTotal, done, failures, failedUntil, failed, heldUntil = null, heldAttempts = 0, updated }) =>
  handle.run(
    `insert into meeting_proposals (path, record_id, digest, proposed, tokens, truncated, parts, parts_total, done, failures, failed_until, failed, held_until, held_attempts, updated) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(path) do update set record_id = excluded.record_id, digest = excluded.digest, proposed = excluded.proposed, tokens = excluded.tokens, truncated = excluded.truncated, parts = excluded.parts, parts_total = excluded.parts_total, done = excluded.done, failures = excluded.failures, failed_until = excluded.failed_until, failed = excluded.failed, held_until = excluded.held_until, held_attempts = excluded.held_attempts, updated = excluded.updated`,
    path,
    id ?? null,
    digest,
    proposed,
    tokens ?? 0,
    truncated && truncated.length > 0 ? JSON.stringify(truncated) : null,
    parts ?? 0,
    partsTotal ?? 0,
    done ? 1 : 0,
    failures ?? 0,
    failedUntil ?? null,
    failed ? 1 : 0,
    heldUntil ?? null,
    Number(heldAttempts) || 0,
    updated,
  )

/** A page that is gone proposes nothing: its mark goes with it. */
export const clearMeetingMark = (handle, path) => handle.run("delete from meeting_proposals where path = ?", path)

/** The paths of every meeting page in the space, for the pass that withdraws a deleted one's proposals. */
export const meetingPagePaths = (handle) => new Set(handle.all("select path from records where kind = 'page' and type = 'meeting'").map((row) => row.path))

/** The paths a save left waiting for their pass. */
export const meetingPendingPaths = (handle) => new Set(handle.all("select path from meeting_pending").map((row) => row.path))

/**
 * Who wrote each meeting page, and **every writer of every version** it has had.
 *
 * `complete` is false when a version is missing — `records.revise
 * {action: "forget_versions"}` erases them, and so does an account erasure. The
 * authorship rule then **fails closed**: a page whose history was erased cannot
 * show who wrote a line, so no line is the person's (0.11 review, blocker 3).
 *
 * `agents` names any save made on an **agent credential**: `change.by.principal`
 * is the gateway's verified `agent`, and in 0.11 an agent does not speak for the
 * person. The agent's *name* never decides this — a person's own credential
 * carries one too — and a press `via: grant` is the person's act.
 */
export const meetingAuthors = (handle, ids = null) => {
  const out = new Map()
  const restrict = Array.isArray(ids) && ids.length > 0
  const where = restrict ? ` and id in (${ids.map(() => "?").join(", ")})` : ""
  const params = restrict ? ids : []
  for (const row of handle.all(`select id, author_user, version from records where kind = 'page' and type = 'meeting'${where}`, ...params)) {
    out.set(row.id, {
      author: row.author_user ?? null,
      writers: new Set(row.author_user ? [row.author_user] : []),
      agents: new Set(),
      stored: 0,
      expected: Math.max(0, Number(row.version) - 1),
      complete: true,
    })
  }
  if (out.size === 0) return out
  const entry = (id) => out.get(id)
  const add = (id, user) => {
    const found = entry(id)
    if (found && user) found.writers.add(user)
  }
  const addAgent = (id, agent) => {
    const found = entry(id)
    if (found && agent) found.agents.add(agent)
  }
  // The live row's last save, and every version's own: `#save` snapshots the
  // record as it was, whose `change.by` names who saved that version and through
  // which agent.
  const principal = (row) => {
    // A press `via: grant` is the person's act, whatever credential carried it;
    // otherwise the gateway's verified principal decides, never the agent name.
    if (row.via === "grant") return "user"
    return row.principal === "agent" ? "agent" : "user"
  }
  for (const row of handle.all(
    `select id, json_extract(change, '$.by.user') as user, json_extract(change, '$.by.principal') as principal, json_extract(change, '$.via') as via from records where kind = 'page' and type = 'meeting'${where}`,
    ...params,
  )) {
    add(row.id, row.user)
    if (principal(row) === "agent") addAgent(row.id, row.user ?? "agent")
  }
  for (const row of handle.all(
    `select v.record_id as id, json_extract(v.snapshot, '$.change.by.user') as user, json_extract(v.snapshot, '$.change.by.principal') as principal, json_extract(v.snapshot, '$.change.via') as via
       from versions v join records r on r.id = v.record_id
      where r.kind = 'page' and r.type = 'meeting'${restrict ? ` and r.id in (${ids.map(() => "?").join(", ")})` : ""}`,
    ...params,
  )) {
    add(row.id, row.user)
    if (principal(row) === "agent") addAgent(row.id, row.user ?? "agent")
    const found = entry(row.id)
    if (found) found.stored += 1
  }
  for (const found of out.values()) {
    // A version the store no longer holds is a history the rule cannot read.
    found.complete = found.stored >= found.expected
  }
  return out
}

/**
 * A meeting page was saved: the next pass reads it, and a restart's scan finds
 * it. **A save clears a page's failure**: a person who edits the page (or the
 * provider coming back) must not leave it marked failed for good (0.11 review,
 * blocker 4).
 */
export const markMeetingPending = (handle, path, nowIso) => {
  handle.run("insert into meeting_pending (path, at) values (?, ?) on conflict(path) do update set at = excluded.at", path, nowIso)
  handle.run("update meeting_proposals set failures = 0, failed = 0, failed_until = null where path = ?", path)
}

/** The pass has read every page it was asked for: the space is no longer work. */
export const clearMeetingPending = (handle, path = null) =>
  path === null ? handle.run("delete from meeting_pending") : handle.run("delete from meeting_pending where path = ?", path)

/** What one model call window spent, as the space's shared day budget reads it. */
export const addMeetingSpend = (handle, at, tokens) =>
  handle.run("insert into meeting_proposal_spend (at, tokens) values (?, ?) on conflict(at) do update set tokens = tokens + excluded.tokens", at, tokens)

/** The tokens every call window between two instants spent. */
export const meetingSpend = (handle, from, to) =>
  Number(handle.get("select coalesce(sum(tokens), 0) as tokens from meeting_proposal_spend where at >= ? and at < ?", from, to)?.tokens) || 0

/** Rows older than the window are not counted again, so they are dropped. */
export const pruneMeetingSpend = (handle, before) => handle.run("delete from meeting_proposal_spend where at < ?", before)

export const hostRows = (handle) => handle.all("select * from job_hosts order by last_seen desc, host_id")

/**
 * `connectors` is the plugin ids active in the host's own process, or null when
 * the host did not say (a legacy host). `incapable` is not touched by a report:
 * it is what the host failed with, for its life.
 */
export const upsertHost = (handle, host, nowIso) =>
  handle.run(
    `insert into job_hosts (host_id, kind, user, plugins, bindings, first_seen, last_seen, connectors) values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict(host_id) do update set kind = excluded.kind, user = excluded.user, plugins = excluded.plugins, bindings = excluded.bindings, last_seen = excluded.last_seen, connectors = excluded.connectors`,
    host.host_id,
    host.kind,
    host.user ?? null,
    json(host.plugins ?? []),
    json(host.bindings ?? []),
    nowIso,
    nowIso,
    Array.isArray(host.connectors) ? JSON.stringify(host.connectors) : null,
  )

/** A host unseen since `before` is gone: its row, and what it failed with, are deleted. */
export const pruneHosts = (handle, before) => handle.run("delete from job_hosts where last_seen < ?", before)

/**
 * What a host row may serve, as a predicate on a connector id, or null when it
 * is unrestricted (the host is legacy and has never failed with "not here"),
 * which is today's claim exactly. A listed host serves exactly its list; either
 * way a connector the host failed with is out for the host's life.
 */
export function abilityOf(row) {
  if (!row) return null
  const connectors = parse(row.connectors, null)
  const listed = Array.isArray(connectors) ? new Set(connectors) : null
  const incapable = new Set(parse(row.incapable, []))
  if (listed === null && incapable.size === 0) return null
  return (connector) => typeof connector === "string" && (listed === null || listed.has(connector)) && !incapable.has(connector)
}

export const hostRow = (handle, hostId) => handle.get("select * from job_hosts where host_id = ?", hostId)

/**
 * This host could not serve the connector: it is not leased to it again. A host
 * that claimed without ever reporting gets a row here, so the mark is not lost.
 */
export function markIncapable(handle, hostId, connector, nowIso) {
  const row = hostRow(handle, hostId)
  if (!row) {
    handle.run("insert into job_hosts (host_id, kind, user, plugins, bindings, first_seen, last_seen, connectors, incapable) values (?, 'personal', null, '[]', '[]', ?, ?, null, ?)", hostId, nowIso, nowIso, JSON.stringify([connector]))
    return
  }
  const held = parse(row.incapable, [])
  if (held.includes(connector)) return
  handle.run("update job_hosts set incapable = ? where host_id = ?", JSON.stringify([...held, connector].slice(-50)), hostId)
}

export const logRows = (handle, runId, limit = 100) =>
  handle
    .all("select * from job_logs where run_id = ? order by seq limit ?", runId, limit)
    // A log line can quote a source's own words (a checkpoint's `failed[]`): a
    // row written before the fix is redacted as it is read (0.11 review B1).
    .map((row) => (typeof row.detail === "string" ? { ...row, detail: errorText(row.detail, 300) } : row))

export function log(handle, runId, at, level, event, detail) {
  const next = handle.get("select coalesce(max(seq), 0) + 1 as seq from job_logs where run_id = ?", runId)
  handle.run("insert into job_logs (run_id, seq, at, level, event, detail) values (?, ?, ?, ?, ?, ?)", runId, next.seq, at, level, event, detail ? String(detail).slice(0, 300) : null)
}

// ---------------------------------------------------------------------------
// Versions, drafts and consent (J1)

export const insertVersion = (handle, version) =>
  handle.run(
    `insert into job_versions (job_id, version, digest, state, origin, base, doc, diff, diff_digest, created, created_by, approved_at, approved_via)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null)`,
    version.job_id,
    version.version,
    version.digest,
    version.state,
    version.origin,
    version.base ?? 0,
    json(version.doc),
    json(version.diff ?? []),
    version.diff_digest,
    version.created,
    version.created_by ?? null,
  )

export const versionRow = (handle, jobId, version) => handle.get("select * from job_versions where job_id = ? and version = ?", jobId, version)
export const versionRows = (handle, jobId) => handle.all("select * from job_versions where job_id = ? order by version desc", jobId)
export const draftRow = (handle, jobId) => handle.get("select * from job_versions where job_id = ? and state = 'draft' order by version desc limit 1", jobId)
export const activeVersionRow = (handle, jobId) => handle.get("select * from job_versions where job_id = ? and state = 'active' order by version desc limit 1", jobId)

export const setVersionState = (handle, jobId, version, state) => handle.run("update job_versions set state = ? where job_id = ? and version = ?", state, jobId, version)

/** The account's owner, once the person's host has reported it (the digest does not cover it). */
export const setVersionDoc = (handle, jobId, version, doc) => handle.run("update job_versions set doc = ? where job_id = ? and version = ?", json(doc), jobId, version)

export const approveVersion = (handle, jobId, version, { at, via }) =>
  handle.run("update job_versions set state = 'active', approved_at = ?, approved_via = ? where job_id = ? and version = ?", at, via, jobId, version)

export const dropVersion = (handle, jobId, version) => handle.run("delete from job_versions where job_id = ? and version = ? and state = 'draft'", jobId, version)

/** Replace the running definition with a version's doc: the one write that makes a version active. */
export const applyDoc = (handle, jobId, doc, { version, digest, at }) =>
  handle.run(
    `update jobs set name = ?, connector = ?, source = ?, account = ?, page = ?, stage = ?, every_ms = ?, scope = ?, kinds = ?, grants = ?, extract = ?, transform = ?, curate = ?, outputs = ?, budgets = ?, owner_id = ?, owner_label = ?, digest = ?, version = ?, updated = ? where id = ?`,
    doc.name,
    doc.connector,
    doc.source,
    doc.account,
    doc.page,
    doc.stage,
    doc.every_ms,
    json(doc.scope),
    json(doc.kinds),
    json(doc.grants),
    json(doc.extract),
    json(doc.transform),
    json(doc.curate),
    json(doc.outputs),
    json(doc.budgets),
    doc.owner?.id ?? "",
    doc.owner?.label ?? null,
    digest,
    version,
    at,
    jobId,
  )

export const insertJobDraft = (handle, job) =>
  handle.run(
    `insert into jobs (id, name, status, version, template, connector, source, account, owner_id, owner_label, scope, kinds, grants, page, stage, digest, every_ms, extract, transform, curate, outputs, budgets, cursor, cursor_at, next_due, failures, reason, created, updated)
     values (?, ?, 'draft', 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null, null, 0, null, ?, ?)`,
    job.id,
    job.name,
    job.template,
    job.connector,
    job.source,
    job.account ?? "default",
    job.owner?.id ?? "",
    job.owner?.label ?? null,
    json(job.scope ?? {}),
    json(job.kinds ?? []),
    json(job.grants ?? []),
    job.page,
    job.stage,
    job.digest,
    job.every_ms,
    json(job.extract ?? []),
    json(job.transform ?? {}),
    json(job.curate ?? []),
    json(job.outputs ?? []),
    json(job.budgets ?? {}),
    job.created,
    job.updated,
  )

export function pubVersion(row) {
  if (!row) return null
  return {
    version: row.version,
    digest: row.digest,
    state: row.state,
    origin: row.origin,
    base: row.base,
    diff_digest: row.diff_digest,
    diff: parse(row.diff, []),
    doc: parse(row.doc, null),
    created: row.created,
    created_by: row.created_by ?? null,
    approved_at: row.approved_at ?? null,
    approved_via: row.approved_via ?? null,
  }
}

export function pubConsent(row) {
  if (!row) return null
  return {
    job_id: row.job_id,
    version: row.version,
    digest: row.digest,
    connector: row.connector,
    source: row.source,
    account: row.account,
    owner: { id: row.owner_id, label: row.owner_label ?? row.owner_id },
    scope: parse(row.scope, {}),
    kinds: parse(row.kinds, []),
    grants: parse(row.grants, []),
    limits: parse(row.limits, null),
    state: row.state,
    reason: row.reason ?? null,
    consented_at: row.consented_at,
    consented_via: row.consented_via,
    consented_by: row.consented_by ?? null,
  }
}

export const consentRow = (handle, jobId) => handle.get("select * from job_consents where job_id = ?", jobId)

export const upsertConsent = (handle, consent) =>
  handle.run(
    `insert into job_consents (job_id, version, digest, connector, source, account, owner_id, owner_label, scope, kinds, grants, limits, state, reason, consented_at, consented_via, consented_by, updated)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'on', null, ?, 'session', ?, ?)
     on conflict(job_id) do update set version = excluded.version, digest = excluded.digest, connector = excluded.connector, source = excluded.source,
       account = excluded.account, owner_id = excluded.owner_id, owner_label = excluded.owner_label, scope = excluded.scope, kinds = excluded.kinds,
       grants = excluded.grants, limits = excluded.limits, state = 'on', reason = null, consented_at = excluded.consented_at,
       consented_via = 'session', consented_by = excluded.consented_by, updated = excluded.updated`,
    consent.job_id,
    consent.version,
    consent.digest,
    consent.connector,
    consent.source,
    consent.account,
    consent.owner_id,
    consent.owner_label ?? null,
    json(consent.scope ?? {}),
    json(consent.kinds ?? []),
    json(consent.grants ?? []),
    json(consent.limits ?? {}),
    consent.consented_at,
    consent.consented_by ?? null,
    consent.updated,
  )

export const requestRow = (handle, jobId) => handle.get("select * from job_requests where job_id = ?", jobId)
export const requestRows = (handle) => handle.all("select * from job_requests order by requested_at, job_id")
export const deleteRequest = (handle, jobId) => handle.run("delete from job_requests where job_id = ?", jobId)

export const upsertRequest = (handle, request) =>
  handle.run(
    `insert into job_requests (job_id, version, digest, requested_by, requested_at, state, owner_id, owner_label, note, reported_at)
     values (?, ?, ?, ?, ?, 'requested', null, null, null, null)
     on conflict(job_id) do update set version = excluded.version, digest = excluded.digest, requested_by = excluded.requested_by,
       requested_at = excluded.requested_at, state = 'requested', owner_id = null, owner_label = null, note = null, reported_at = null`,
    request.job_id,
    request.version,
    request.digest,
    request.requested_by,
    request.requested_at,
  )

export const reportRequest = (handle, jobId, { state, owner, note, at }) =>
  handle.run("update job_requests set state = ?, owner_id = ?, owner_label = ?, note = ?, reported_at = ? where job_id = ?", state, owner?.id ?? null, owner?.label ?? null, note ?? null, at, jobId)

export function pubRequest(row) {
  if (!row) return null
  return {
    version: row.version,
    digest: row.digest,
    state: row.state,
    requested_by: row.requested_by,
    requested_at: row.requested_at,
    owner: row.owner_id ? { id: row.owner_id, label: row.owner_label ?? row.owner_id } : null,
    // Another host's probe can send the source's own words: a row before the
    // fix holds them raw, so they are redacted as they are answered (round 2, S3).
    note: row.note ? errorText(row.note, 500) : null,
    reported_at: row.reported_at ?? null,
  }
}

export const deleteJobRows = (handle, jobId) => {
  handle.run("delete from job_lens where job_id = ?", jobId)
  handle.run("delete from job_curation where job_id = ?", jobId)
  handle.run("delete from job_requests where job_id = ?", jobId)
  handle.run("delete from job_consents where job_id = ?", jobId)
  handle.run("delete from job_versions where job_id = ?", jobId)
  handle.run("delete from jobs where id = ?", jobId)
}


// ---------------------------------------------------------------------------
// What the extract engine has already sent to the model (J4 review, finding 4)

/** The items this job has already sent to the model, as `(connector, account, external_id)` keys. */
export const extractedIds = (handle, jobId) =>
  new Set(handle.all("select connector, account, external_id from job_extracted where job_id = ?", jobId).map((row) => `${row.connector}\u0000${row.account}\u0000${row.external_id}`))

/** Mark the items one run sent to the model, so a later run sends only new ones. */
export const markExtracted = (handle, { job_id, connector, account, external_id, run_id, at }) =>
  handle.run(
    "insert into job_extracted (job_id, connector, account, external_id, run_id, at) values (?, ?, ?, ?, ?, ?) on conflict(job_id, connector, account, external_id) do update set run_id = excluded.run_id, at = excluded.at",
    job_id,
    connector,
    account,
    external_id,
    run_id,
    at,
  )
