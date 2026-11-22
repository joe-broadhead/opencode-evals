/**
 * The job tables of a space's SQLite file (DESIGN-MEMORY-JOBS §1.2).
 *
 * Additive on purpose, like the plugin tables: an older records service opens a
 * file with them and ignores them, so a rollback touches no space file. They
 * sit beside `runs` and `events` because a job's ledger belongs to the space.
 *
 * - `jobs` is one current definition per job, with its digest, its cursor and
 *   its next due time.
 * - `job_runs` is the run ledger and the lease: `lease_host`, `lease_epoch`
 *   and `lease_expires`, so a stale host cannot write (§4.2).
 * - `job_items` is the staging area, keyed **`(connector, account,
 *   external_id)`** — globally, as §4.2 says, so one collected event is one
 *   row however many jobs read it. It points at the stored event, so the page
 *   cites `[event evt_…]` and the text is not copied.
 * - `job_curation` is each job's own curate state over those items: which ones
 *   its block already holds. Two jobs over the same event never share it.
 * - `job_hosts` is what each host reported at its heartbeat (§3.2).
 * - `job_logs` is bounded per run and never holds collected text (§4.2).
 * - `meeting_proposals` is what a meeting page proposed from, by the digest of
 *   its notes and transcript (0.11): a re-save of the same text is skipped, and
 *   no page text is kept. `meeting_proposal_spend` is the day's tokens it spent.
 * - `job_versions` is every version a job has had and the draft above it (J1,
 *   §1.2): immutable, with its digest, the version it was made against and the
 *   diff. `job_consents` is the person's confirmation at one version, with the
 *   limits a later version is judged against (§5.4). `job_requests` is the
 *   bind-like ask and the account the person's host reported (§5.2).
 */
export const JOBS_SCHEMA = `
create table if not exists jobs (
  id text primary key,
  name text not null,
  status text not null,
  version integer not null,
  template text not null,
  connector text not null,
  source text not null,
  account text not null,
  owner_id text not null,
  owner_label text,
  scope text not null default '{}',
  kinds text not null default '[]',
  grants text not null default '[]',
  page text not null,
  stage text not null,
  digest text not null,
  every_ms integer not null,
  extract text not null default '[]',
  transform text not null default '{}',
  curate text not null default '[]',
  outputs text not null default '[]',
  budgets text not null default '{}',
  cursor text,
  cursor_at text,
  next_due text,
  failures integer not null default 0,
  reason text,
  created text not null,
  updated text not null
) without rowid;

create table if not exists job_runs (
  id text primary key,
  job_id text not null,
  version integer not null,
  digest text not null,
  status text not null,
  lease_host text,
  lease_epoch integer not null default 0,
  lease_expires text,
  cursor_before text,
  cursor_after text,
  counts text not null default '{}',
  refusals text not null default '[]',
  outcome text,
  error text,
  started text not null,
  finished text,
  curated text
) without rowid;
create index if not exists job_runs_job on job_runs(job_id, started, id);
create index if not exists job_runs_status on job_runs(status, started);

create table if not exists job_items (
  connector text not null,
  account text not null,
  external_id text not null,
  event_id text not null,
  job_id text not null,
  run_id text not null,
  occurred_at text not null,
  stored text not null,
  primary key (connector, account, external_id)
) without rowid;
create index if not exists job_items_run on job_items(run_id);
create index if not exists job_items_occurred on job_items(occurred_at, external_id);

create table if not exists job_curation (
  job_id text not null,
  connector text not null,
  account text not null,
  external_id text not null,
  run_id text not null,
  curated integer not null default 0,
  primary key (job_id, connector, account, external_id)
) without rowid;
create index if not exists job_curation_curated on job_curation(job_id, curated);

-- A cancellation withdraws the item it names (DESIGN-MEMORY-JOBS §6.2): the
-- same external id, listed again with kind "event" and the label "cancelled".
-- Additive, so no space file needs a migration: the row is the job's own.
create table if not exists job_withdrawals (
  job_id text not null,
  connector text not null,
  account text not null,
  external_id text not null,
  run_id text not null,
  at text not null,
  primary key (job_id, connector, account, external_id)
) without rowid;

-- The items the extract engine has already sent to the model, per job (J4
-- review, finding 4): a later run sends only what it has never sent, and a
-- batch that failed is sent again because its rows were never written.
create table if not exists job_extracted (
  job_id text not null,
  connector text not null,
  account text not null,
  external_id text not null,
  run_id text not null,
  at text not null,
  primary key (job_id, connector, account, external_id)
) without rowid;

-- One row per UTC day a **binding** restarted its window (§9.3). The limit is the
-- binding's, not the job's: two jobs over one source and account share it, and a
-- second gap the same day pauses the binding, and with it every job on it.
create table if not exists binding_resyncs (
  source text not null,
  account text not null,
  day text not null,
  job_id text not null,
  run_id text not null,
  reason text not null,
  since text,
  at text not null,
  -- The binding's cursor when the resync was counted: the same gap at a held
  -- position is the same resync, and the same gap after the cursor advanced is
  -- a new restart (A2).
  cursor text,
  primary key (source, account, day)
) without rowid;

-- The block a job last wrote, by its own content hash (review follow-up 3): the
-- server keeps it, so no client write can claim a block is the job's.
create table if not exists job_lens (
  job_id text primary key,
  hash text not null,
  run_id text,
  updated text not null
) without rowid;

create table if not exists job_hosts (
  host_id text primary key,
  kind text not null,
  user text,
  plugins text not null default '[]',
  bindings text not null default '[]',
  first_seen text not null,
  last_seen text not null,
  -- The plugin ids active in the host's own process (lane 0189): JSON, exact.
  -- Null means the host never said (a legacy host), which claims as before.
  connectors text,
  -- The connectors this host failed with "not here", JSON, for the host's life:
  -- they are not leased to it again, and they are not failures of the job.
  incapable text
) without rowid;

-- Every version a job has had, and the draft above it (J1, §1.2). A version is
-- immutable: doc is the definition, digest its canonical hash, base the
-- version it was made against, and diff what changed (with its own digest).
-- state is draft | active | superseded. A draft never runs: only the jobs row
-- (the active version) is claimable, and a run records the version it ran.
create table if not exists job_versions (
  job_id text not null,
  version integer not null,
  digest text not null,
  state text not null,
  origin text not null,
  base integer not null default 0,
  doc text not null,
  diff text not null default '[]',
  diff_digest text not null,
  created text not null,
  created_by text,
  approved_at text,
  approved_via text,
  primary key (job_id, version)
) without rowid;
create index if not exists job_versions_state on job_versions(job_id, state);

-- The person's consent for one job, at one version (§5.4, §5.6). It records
-- the account, scope, grants and limits they confirmed in a browser session;
-- a later version is judged by content against those limits.
create table if not exists job_consents (
  job_id text primary key,
  version integer not null,
  digest text not null,
  connector text not null,
  source text not null,
  account text not null,
  owner_id text not null,
  owner_label text,
  scope text not null default '{}',
  kinds text not null default '[]',
  grants text not null default '[]',
  limits text not null default '{}',
  state text not null,
  reason text,
  consented_at text not null,
  consented_via text not null,
  consented_by text,
  updated text not null
) without rowid;

-- The bind-like request for a job's consent (§5.2, §5.6): the person asks,
-- their own host reports the account it is signed in as (jobs.probe), and the
-- console confirms that account. An owner-only probe: no one else may answer.
create table if not exists job_requests (
  job_id text primary key,
  version integer not null,
  digest text not null,
  requested_by text not null,
  requested_at text not null,
  state text not null,
  owner_id text,
  owner_label text,
  note text,
  reported_at text
) without rowid;

create table if not exists job_logs (
  run_id text not null,
  seq integer not null,
  at text not null,
  level text not null,
  event text not null,
  detail text,
  primary key (run_id, seq)
) without rowid;

-- Meeting pages the engine has already read (0.11, opencode-mem#58 item 2): the
-- digest of the notes and the transcript the proposals were drawn from, so a
-- re-save of the same text proposes nothing again. A re-save that changes the
-- text has a new digest and is read again; the proposals it makes are still
-- keyed by content, so a word moved does not duplicate a proposal already
-- waiting. No text of the page is kept here, only the digest. The truncated
-- column says what the pass could not read (a cap or the token budget), so a
-- short reading is never silent.
create table if not exists meeting_proposals (
  path text primary key,
  record_id text,
  digest text not null,
  proposed integer not null default 0,
  tokens integer not null default 0,
  truncated text,
  -- How far the page has been read: parts of parts_total, and done once
  -- every part is. A page larger than one run's budget is resumed, never
  -- re-sent from its first line (0.11 review, blocker 2).
  parts integer not null default 0,
  parts_total integer not null default 0,
  done integer not null default 0,
  -- A part that keeps failing is not retried forever: attempts, the instant it
  -- may be tried again, and failed once the cap is reached (needs attention).
  failures integer not null default 0,
  failed_until text,
  failed integer not null default 0,
  -- A part whose claim the trait gate held waits for the hold's own pause
  -- (design §5.4): the instant it may be read again, and how many times it has
  -- waited, so a down classifier does not re-read it on every tick.
  held_until text,
  held_attempts integer not null default 0,
  updated text not null
) without rowid;

-- A meeting page saved since its last proposal pass. The store writes it with
-- the save, the pass clears it, and the scheduler's index reads its count, so a
-- space is opened for a meeting only when one is waiting — a restart's first
-- scan finds the ones saved before it.
create table if not exists meeting_pending (
  path text primary key,
  at text not null
) without rowid;

-- What proposing from meeting pages spent, per call window: the same day budget
-- the routines and the jobs share counts it (model-guard.js), so proposals made
-- from a page leave the rest of the day less. Pruned with the day window.
create table if not exists meeting_proposal_spend (
  at text not null,
  tokens integer not null default 0,
  primary key (at)
) without rowid;
`
