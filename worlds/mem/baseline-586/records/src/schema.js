import { createHash } from "node:crypto"
import { JOBS_SCHEMA } from "./jobs/schema.js"
import { SILVER_BUILD, SILVER_PROTECTION_VERSION, SILVER_SCHEMA } from "./silver/schema.js"

/**
 * The schema of one space's SQLite file, versioned in `meta(schema_version)`.
 * Migrations run in order at open, each in its own transaction. A file from a
 * newer service (a higher version) is refused rather than guessed at.
 */

const V1 = `
create table meta (key text primary key, value text not null) without rowid;

create table records (
  rid integer primary key,
  id text not null unique,
  kind text not null,
  type text not null,
  path text,
  title text not null default '',
  body text not null default '',
  extra text not null default '',
  status text not null,
  stated_by text not null,
  fields text not null default '{}',
  supersedes text not null default '[]',
  superseded_by text,
  source text not null default '{}',
  task text,
  author_user text,
  author_agent text,
  owner text,
  links text not null default '[]',
  change text not null default '{}',
  created text not null,
  updated text not null,
  version integer not null default 1
);
create unique index records_path on records(path) where path is not null;
create index records_kind_status on records(kind, status, updated, id);
create index records_updated on records(updated, id);

-- Every earlier state of a record, for history. Deleted with the record.
create table versions (
  record_id text not null,
  version integer not null,
  snapshot text not null,
  saved text not null,
  primary key (record_id, version)
) without rowid;

-- Edges: link ([[…]] and fields.links), supersedes (new → old), source (record → evt_/msg-/rec_).
create table links (
  src text not null,
  dst text not null,
  type text not null,
  primary key (src, dst, type)
) without rowid;
create index links_dst on links(dst, type, src);

-- Full text over title, body, path and aliases/tags; porter stemming. The
-- explicit integer key keeps rowids stable across VACUUM.
create virtual table records_fts using fts5(
  title, body, path, extra,
  content='records', content_rowid='rid', tokenize='porter unicode61'
);
create trigger records_fts_insert after insert on records begin
  insert into records_fts(rowid, title, body, path, extra) values (new.rid, new.title, new.body, new.path, new.extra);
end;
create trigger records_fts_update after update of title, body, path, extra on records begin
  insert into records_fts(records_fts, rowid, title, body, path, extra) values ('delete', old.rid, old.title, old.body, old.path, old.extra);
  insert into records_fts(rowid, title, body, path, extra) values (new.rid, new.title, new.body, new.path, new.extra);
end;
create trigger records_fts_delete after delete on records begin
  insert into records_fts(records_fts, rowid, title, body, path, extra) values ('delete', old.rid, old.title, old.body, old.path, old.extra);
end;

create table events (
  id text primary key,
  source text not null,
  account text not null,
  external_id text not null,
  kind text not null,
  occurred_at text not null,
  thread text,
  actors text not null default '[]',
  title text,
  text text,
  url text,
  labels text not null default '[]',
  hash text not null,
  ingested_at text not null
) without rowid;
create index events_occurred on events(occurred_at, id);
create index events_source on events(source, account);
create index events_ingested on events(ingested_at);

create table sources (
  source text not null,
  account text not null,
  owner_id text,
  owner_label text,
  status text not null,
  confirmed_at text,
  cursor text,
  cursor_at text,
  enabled integer not null default 1,
  created text not null,
  updated text not null,
  primary key (source, account)
) without rowid;

-- The routines' run ledger and per-day budget (putRun/listRuns). The run is
-- kept whole as JSON; the columns are what listRuns filters and sorts on.
-- seq is the order of the first write, kept on upsert, for ties on started.
create table runs (
  id text primary key,
  seq integer not null,
  routine text,
  date text,
  budget_day text,
  status text,
  started text,
  run text not null
) without rowid;
create index runs_started on runs(started, seq);
`

/** Each entry moves the schema from version index to index + 1. */
export const MIGRATIONS = [(db) => db.exec(V1), (db) => db.exec(`
create table agents_seen (
  user text not null,
  agent text not null,
  first_seen text not null,
  last_seen text not null,
  primary key (user, agent)
) without rowid;
create index agents_seen_last on agents_seen(last_seen);
`), (db) => db.exec(`
create table idempotent_writes (
  user_id text not null,
  key text not null,
  digest text not null,
  record_id text not null,
  primary key (user_id, key)
) without rowid;
`), (db) => db.exec(`
create table held_batches (
  user_id text not null,
  key text not null,
  digest text not null,
  receipt text not null,
  primary key (user_id, key)
) without rowid;
`), (db) => db.exec(`
-- A migration key survives record deletion so a retry cannot resurrect it.
create table legacy_commitments (
  legacy_id text primary key,
  record_id text not null
) without rowid;
`), (db) => db.exec(`
-- One row per OpenCode session Memory has seen, and which side saw it first
-- (DESIGN §15.1, B8). A session is curated once, keyed on its OpenCode id:
-- capture wins, so History's events for a captured session are refused, and
-- History-first items are withdrawn from curation when capture arrives later
-- (events.curated_by). Forward only: there is no way back from this version.
create table sessions_seen (
  session_id text primary key,
  first_side text not null check (first_side in ('capture', 'history')),
  first_event_id text,
  at text not null,
  updated text not null
) without rowid;
create index sessions_seen_updated on sessions_seen(updated);
alter table events add column session_id text;
alter table events add column curated_by text;
create index events_session on events(session_id);
`), (db) => {
  // The cursor a resync was counted at (A2): the jobs schema creates this table
  // additively, so a file opened before the column existed gains it here, and a
  // fresh file gets it from `JOBS_SCHEMA`. Forward only.
  const table = db.prepare("select 1 as found from sqlite_master where type = 'table' and name = 'binding_resyncs'").get()
  if (!table) return
  const columns = db.prepare("pragma table_info(binding_resyncs)").all().map((column) => column.name)
  if (!columns.includes("cursor")) db.exec("alter table binding_resyncs add column cursor text")
}]

export const SCHEMA_VERSION = MIGRATIONS.length

/**
 * Additive tables: created at every open when missing, without raising
 * `schema_version`, so an older service still opens the file and ignores them
 * (a rollback touches no space file). Only data an older service can safely
 * ignore goes here: short-lived ledgers, and the forgotten-copy fingerprints.
 *
 * `write_receipts` is the keyed-write ledger
 * (docs/design/records-idempotency.md): one row per (user, agent, key), with
 * the method, a digest of the request and the ids and versions it produced,
 * never content. Rows expire after the receipt window.
 */
export const ADDITIVE = `
${SILVER_SCHEMA}
create table if not exists write_receipts (
  user_id text not null,
  agent text not null,
  key text not null,
  method text not null,
  digest text not null,
  receipt text not null,
  created text not null,
  primary key (user_id, agent, key)
) without rowid;
create index if not exists write_receipts_created on write_receipts(created);

-- Forgotten-copy fingerprints (records/src/forgotten.js): keyed hashes of a
-- forgotten text's copy features, never the text, one key per author. They
-- lift only in a browser session of the console. Additive on purpose: an
-- older service ignores these tables (recall then says it cannot withhold).
create table if not exists forgotten_keys (
  author_user text primary key,
  key text not null,
  created text not null
) without rowid;
create table if not exists forgotten_prints (
  id text primary key,
  author_user text not null,
  digest text not null,
  kind text not null,
  created text not null,
  fingerprint text not null,
  unique (author_user, digest)
) without rowid;
create index if not exists forgotten_prints_author on forgotten_prints(author_user, created);

-- Forget tombstones (FABLE records #2): what a forget or delete leaves so
-- the routines never write it back. One row per routine key ("key:…") or
-- source ref ("ref:msg-…", "ref:evt_…") of a deleted record; no content.
-- Additive: an older service ignores it.
create table if not exists routine_tombstones (
  key text primary key,
  created text not null
) without rowid;

-- Read marks (daily-yield FINDINGS R6, design §14 S0): one row per unit of one
-- local day that the model read, with the fingerprint of the refs it read.
-- A re-run reads only the units with no mark or a different fingerprint. It is
-- additive on purpose: an older service opens the file unchanged and ignores
-- it, which at worst costs a re-read. Pruned with the events it is about.
create table if not exists unit_reads (
  day text not null,
  unit_key text not null,
  fingerprint text not null,
  run_id text,
  read_at text not null,
  primary key (day, unit_key)
) without rowid;
create index if not exists unit_reads_read_at on unit_reads(read_at);

-- The trait gate's verdict cache (lane 0198): one row per text the classifier
-- judged for a local day - "kept", or the category it dropped - keyed by the
-- text's own hash, never the text. A later run of the day asks only about the
-- titles and claims this table does not hold, which is where a busy day's
-- repeated classifier calls came from. Bounded per day by the writer and pruned
-- with the events it is about. Additive on purpose: an older service opens the
-- file unchanged and ignores it, and a lost row costs one re-judge.
create table if not exists trait_reads (
  day text not null,
  key text not null,
  verdict text not null,
  refs text not null default '[]',
  read_at text not null,
  primary key (day, key)
) without rowid;
create index if not exists trait_reads_read_at on trait_reads(read_at);

-- Text tombstones (routine-safety review, item 3): the keyed hash of each
-- normalised sentence of a forgotten or deleted memory or commitment, and its
-- length in words, written by the service at forget time, whatever the
-- client's fingerprint did. The key is the space's (meta forget_text_key).
create table if not exists forgotten_texts (
  hash text primary key,
  words integer not null,
  created text not null
) without rowid;

-- A forget walks the supersession lineage back through superseded_by
-- (docs/design/forget-erase.md); without this a forget scans every record.
create index if not exists records_superseded_by on records(superseded_by) where superseded_by is not null;

-- The trait gate's holds (design §5.4, trust H5): a claim whose classifier did
-- not answer waits here, never filed and never dropped, and the next run
-- retries it. The claim as the routine read it, its ref, why it waits, and how
-- often it was retried; a hold whose event is gone is reaped. Additive: an
-- older service ignores it.
create table if not exists trait_holds (
  key text primary key,
  ref text,
  item text not null,
  refs text,
  reason text not null default '',
  attempts integer not null default 0,
  attempted text,
  created text not null
) without rowid;
create index if not exists trait_holds_created on trait_holds(created);

-- Outbox purge entries (0.9.8 slice 6a, docs/design/forget-erase.md): one per
-- forget, for its caller only. Salted hashes of the erased sentences, never
-- text; the salt is null when the service derives it from its forget secret.
-- Deleted, salt and all, when the window ends. Additive: an older service
-- ignores it.
create table if not exists forget_purges (
  id text primary key,
  author_user text not null,
  created text not null,
  expires text not null,
  salt text,
  lengths text not null,
  hashes text not null
) without rowid;
create index if not exists forget_purges_author on forget_purges(author_user, created);
create index if not exists forget_purges_expires on forget_purges(expires);

-- Memory Jobs (DESIGN-MEMORY-JOBS §1.2): the job ledger, beside runs and events.
${JOBS_SCHEMA}

-- Bind requests (docs/design/memory-funnel-v1.md §10): the person asked, in the
-- console, to collect from a source; the person's collector reads only these
-- sources' signed-in account and reports it here for the person to confirm.
-- The request column is JSON ({streams?, ...}), so a request can carry more (such as a
-- stream selection) without a migration. Additive: an older service ignores it.
create table if not exists source_requests (
  source text not null,
  account text not null,
  requested_by text not null,
  requested_at text not null,
  request text not null default '{}',
  state text not null,
  owner_id text,
  owner_label text,
  reported_account text,
  reported_at text,
  note text,
  failures integer not null default 0,
  retry_at text,
  primary key (source, account)
) without rowid;

-- The last collection from each bound source, as the person's collector
-- reported it (sources.collected, 0.9.8): when, whether it worked, and why not.
-- Shown on Sources in the console. Additive: an older service ignores it.
-- SEC-0912 (F11): one row for every hard delete, forget and retire of a
-- record, written in the same transaction as the change. Ids only, never
-- content: who (the memory user, a user or an agent principal, over a bearer
-- or a console session, or the routines), the action, the record's kind and
-- id, and when. A purge deletes the whole file; control's space.purge audit
-- row records it. The read side is S2. Additive: an older service ignores it.
create table if not exists delete_audit (
  seq integer primary key autoincrement,
  at text not null,
  action text not null,
  record_id text not null,
  record_kind text not null,
  actor_user text not null,
  principal text not null,
  credential text not null,
  space text
);

create table if not exists source_collections (
  source text not null,
  account text not null,
  at text not null,
  ok integer not null,
  error text,
  accepted integer,
  failed_since text,
  primary key (source, account)
) without rowid;

-- A refused collected event (DESIGN-jelly-sources §0.2, §2.3.1; 0.11): the
-- contract's policy advances the cursor past refused[], so a refusal is a
-- real loss and must be visible rather than silent. One row per refused event,
-- written in the page's own transaction: the source, the account, and the
-- event's id and kind, with the reason the store or the consent refused it.
-- Ids and the refusal's own sentence only: never the event's title or text,
-- which is exactly what a refusal must not keep. Sources reports the count,
-- the newest row's id and its reason. Additive: an older service ignores it.
create table if not exists event_refusals (
  seq integer primary key autoincrement,
  at text not null,
  source text not null,
  account text not null,
  external_id text,
  kind text,
  reason text not null
);
create index if not exists event_refusals_source on event_refusals(source, account, seq);


-- Where a record's copies live (DESIGN-jelly-sources §5.2, 0.11): the copier
-- registers the copy in the record's own space, because a space cannot read
-- another space's file and a records service in a cell may not hold both. A
-- source removal reads this to **report** copies it cannot retract — another
-- space's record is that space's, never the source's to delete. Ids only:
-- whose record, which space, which copy, and when. Additive: an older service
-- ignores it, and a removal that finds none says nothing.
create table if not exists shared_copies (
  record_id text not null,
  space text not null,
  copy_id text not null default '',
  -- The event the original was drawn from, as the store read it (a source
  -- edge, a cited field, a body citation): one row per event, because a **move**
  -- deletes the original and this is the only way a removal still reports the
  -- copy. An empty id is a copy that derives from no event, reported by record.
  event_id text not null default '',
  at text not null,
  primary key (record_id, space, copy_id, event_id)
) without rowid;

-- The verified-caller grant ledger (docs/design/adr-verified-caller-grants.md
-- §4.8, S1a): one row per grant spent in this store, keyed by the host and the
-- grant's single-use id, written in the same transaction as the act. A second
-- use fails on the primary key, so that transaction rolls back and the first
-- use stands. It holds no content: the act's own answer is the receipt, and
-- the input only as its digest. Additive on purpose, like the other ledgers:
-- an older service ignores the table, and a rollback leaves it unused.
create table if not exists act_grants (
  host text not null,
  jti text not null,
  act text not null,
  input_digest text not null,
  user_id text not null,
  device text not null,
  class text not null,
  item text,
  exp integer not null,
  spent_at text not null,
  receipt text not null,
  primary key (host, jti)
) without rowid;
create index if not exists act_grants_exp on act_grants (exp);
-- The snapshot a preview showed (0.11, Jelly's press): the fields a page never
-- sends back — a copy's page version and computed file, a space change's state
-- digest — keyed by the act, the digest of the input the person chose, the
-- person and the host they press through, for a few minutes. Written when a
-- state-bound act's preview runs (acts.preview), spent once by the press that
-- finds it (acts.apply), and never a change to anything the person owns. A
-- second preview of the same key replaces the row only for the same person and
-- host, and says so in revisions, with the superseded bindings in previous.
-- Additive: an older service ignores it, and a copy restored from a snapshot
-- carries no preview.
create table if not exists act_previews (
  act text not null,
  input_digest text not null,
  user_id text not null,
  host text not null,
  binding text not null,
  previous text,
  revisions integer not null default 1,
  created_at text not null,
  exp integer not null,
  primary key (act, input_digest, user_id, host)
) without rowid;
create index if not exists act_previews_exp on act_previews (exp);
-- The reservations an act whose change spans services left (A2–A9, A11, and
-- A12's erase): one row per spent grant, written in the same transaction as the
-- ledger row and kept after the ledger's cleanup. Ids only, never content: who
-- pressed, in which host and on which device, which act, the store it
-- concerned, and the outcome written when the reservation settles: applied,
-- refused, partial, or unrecorded when no settle came, with the id of what it
-- made, if anything. The ledger's receipt is pruned 300 s
-- after the grant's window; this row is the record that outlives it. Additive:
-- an older service ignores it.
create table if not exists act_audit (
  seq integer primary key autoincrement,
  at text not null,
  act text not null,
  host text not null,
  jti text not null,
  user_id text not null,
  device text not null,
  class text not null,
  space text,
  outcome text,
  item text
);
-- Plugin declarations (DESIGN-PLUGIN-MEMORY §2.3, §3.2), as the person's
-- collector discovered them (plugins.report) and this service validated them
-- again: one row per plugin id, with its package, source, version, digest and
-- state (available, invalid, unverified, conflict). manifest_json is kept only
-- for a declaration that passed the frame. A report grants nothing. Additive:
-- an older service ignores it.
create table if not exists plugins (
  plugin_id text primary key,
  package_name text,
  source_kind text not null,
  source_ref text not null,
  version text,
  digest text,
  manifest_json text,
  namespace text,
  state text not null,
  reason text,
  edited integer not null default 0,
  first_seen text not null,
  last_seen text not null,
  listed_at text
) without rowid;
-- Rule 6 (§2.3): the first digest seen for each package install at one
-- version; a different digest at the same version is an edited install.
create table if not exists plugin_digests (
  plugin_id text not null,
  package_name text not null,
  source_ref text not null,
  version text not null,
  digest text not null,
  first_seen text not null,
  primary key (plugin_id, package_name, source_ref, version)
) without rowid;

-- Plugin-declared sources (DESIGN-PLUGIN-MEMORY S2, records/src/plugins/consent.js):
-- the person's requests and their collector's probe; one consent per
-- (source, account), with the pin, the snapshot and limits the person
-- confirmed in a browser session; the changes that wait for them, and the
-- ones applied. Additive: an older service ignores them.
create table if not exists plugin_requests (
  source text not null,
  account text not null,
  plugin_id text not null,
  requested_by text not null,
  requested_at text not null,
  state text not null,
  owner_id text,
  owner_label text,
  reported_account text,
  digest text,
  scope_options text,
  note text,
  failures integer not null default 0,
  retry_at text,
  reported_at text,
  primary key (source, account)
) without rowid;
create table if not exists plugin_consents (
  source text not null,
  account text not null,
  plugin_id text not null,
  package_name text not null,
  source_kind text not null,
  source_ref text not null,
  version text,
  digest text not null,
  live_digest text,
  snapshot_json text not null,
  limits_json text,
  scope_json text not null,
  owner_id text not null,
  owner_label text,
  state text not null,
  reason text,
  pause_code text,
  declaration_changed integer not null default 0,
  consented_at text not null,
  consented_via text not null,
  consented_by text not null,
  updated text not null,
  primary key (source, account)
) without rowid;
create table if not exists plugin_pending (
  source text not null,
  account text not null,
  seq integer not null,
  plugin_id text not null,
  digest text not null,
  class text not null,
  what text not null,
  created text not null,
  primary key (source, account, seq)
) without rowid;
create table if not exists plugin_changes (
  seq integer primary key autoincrement,
  source text not null,
  account text not null,
  plugin_id text not null,
  class text not null,
  what text not null,
  from_digest text,
  to_digest text,
  at text not null
);

-- The claims log (S2, docs/design/memory-routines-v1.md §4.2): one cited
-- statement per row, in the space's own file. A repeat updates its count and
-- its dates in place, and its refs keep the first citation and the 19 most
-- recent. The knowledge key is content-based, and the claim key is what a
-- rejection is remembered against. Additive on purpose: an older service opens
-- the file and ignores it, so a rollback touches no space file.
create table if not exists claims (
  id text primary key,
  claim_key text not null unique,
  knowledge_key text not null,
  type text not null,
  subject text not null,
  attribute text not null,
  value text not null default '',
  statement text not null default '',
  stated_by text not null,
  quote text not null default '',
  quotes text not null default '{}',
  statements text not null default '{}',
  shared_quotes text not null default '[]',
  shared_statements text not null default '[]',
  authors text not null default '{}',
  refs text not null default '[]',
  source text not null default '',
  version text not null default '',
  state text not null,
  first_seen text not null,
  last_seen text not null,
  count integer not null default 1
) without rowid;
create index if not exists claims_knowledge on claims(knowledge_key, state);
create index if not exists claims_subject on claims(subject, attribute);
create index if not exists claims_last_seen on claims(last_seen, state);

-- The person's decisions about a claim, as keyed hashes and never text:
-- a rejected mark survives a different extractor digest or a rebuild. A claim
-- expiry writes no mark, so a later sighting may propose it again.
create table if not exists claim_marks (
  key text primary key,
  kind text not null,
  created text not null
) without rowid;

-- A person's edit pins its attribute (design §5.3): a later source value that
-- differs is a proposal, never a replacement.
create table if not exists claim_pins (
  subject text not null,
  attribute text not null,
  value text not null,
  by_user text,
  at text not null,
  primary key (subject, attribute)
) without rowid;

-- A projection line: what a record or page shows, and the claim ids it cites.
-- A forget removes the line, or re-projects it from the claims that remain.
-- The state is the projection's own (proposed, current, superseded) and the
-- payload holds the type's value or a commitment's lifecycle state.
create table if not exists claim_lines (
  line_key text primary key,
  kind text not null,
  type text not null,
  subject text not null,
  attribute text not null default '',
  text text not null default '',
  state text not null,
  payload text not null default '{}',
  claims text not null default '[]',
  supersedes text,
  updated text not null
) without rowid;
create index if not exists claim_lines_subject on claim_lines(subject, type, state);

-- The refs of a claim, one row each, with the author that ref belongs to. The
-- forget selects by ref and by author from these indexes instead of scanning
-- the log (S2 re-review, M4). Additive.
create table if not exists claim_refs (
  claim_id text not null,
  ref text not null,
  author text not null default '',
  primary key (claim_id, ref)
) without rowid;
create index if not exists claim_refs_ref on claim_refs(ref, claim_id);
create index if not exists claim_refs_author on claim_refs(author, claim_id);

-- The claim ids a projection line cites, one row each, so a forget finds the
-- lines that cite a claim by index rather than by reading every line.
create table if not exists claim_line_cites (
  line_key text not null,
  claim_id text not null,
  primary key (line_key, claim_id)
) without rowid;
create index if not exists claim_line_cites_claim on claim_line_cites(claim_id, line_key);

-- A forget too large for one transaction waits here between slices: its input
-- and how many claims still match. Additive, like the rest of the layer.
create table if not exists claim_forget_pending (
  id text primary key,
  input text not null,
  created text not null,
  updated text not null,
  remaining integer not null default 0
) without rowid;

-- When a projected page last changed, so a rebuild writes at most once per
-- page per 15 minutes (design §4.3) and only on a real change.
create table if not exists claim_page_writes (
  path text primary key,
  at text not null,
  digest text not null
) without rowid;

-- The engine (S3a, docs/design/s3-engine-plan.md §2). Everything is additive so
-- an older service opens the file unchanged and ignores it; with
-- RECORDS_ENGINE=off writes no row here is written and every engine column stays
-- null.
--
-- An event's lane is read by one index per source, account and lane, above the
-- lane cursor: a batch carries one source and walks one lane in seq order.
create index if not exists events_lane on events(source, account, lane, seq) where seq is not null;
-- The runner asks a space which lane keys have work and whether a lane holds
-- any row, on every pass and every tick. This index is the first query's own
-- predicate (lane is not null) and a prefix search for the second (lane is
-- 'own') (0180): without it both scanned every event of the space.
create index if not exists events_lane_key on events(lane, source, account) where lane is not null;
-- And one over the rows whose content changed more often than a day allows, so
-- the next day's pass finds them without reading the table. It holds nothing
-- while the engine is off, because their count is null.
create index if not exists events_reentry_capped on events(reentry_day) where reentry_count >= 3;
-- The highest seq below which one lane's items from one source are filed.
create table if not exists lane_cursors (
  lane text not null,
  source text not null,
  account text not null,
  cursor integer not null default 0,
  updated text not null,
  primary key (lane, source, account)
) without rowid;
-- The small retry set (design §10.1): a failed item, a deferred thread, or a
-- claim the trait gate holds. At most 2,000 rows per space, trait_holds
-- counted as held, and at the cap a lane stops advancing.
create table if not exists lane_retry (
  event_id text primary key,
  lane text not null,
  source text not null,
  account text not null,
  kind text not null,
  attempts integer not null default 0,
  not_before text,
  reason text not null default '',
  created text not null
) without rowid;
create index if not exists lane_retry_due on lane_retry(lane, source, account, not_before);
-- One line per committed batch: what it covered, what it cost, and the digest of
-- its answer. Tokens are the provider's billed ones only (design §6).
create table if not exists lane_ledger (
  id text primary key,
  at text not null,
  lane text not null,
  source text not null,
  account text not null,
  lo integer not null default 0,
  hi integer not null default 0,
  items integer not null default 0,
  tier text,
  tokens integer not null default 0,
  calls integer not null default 0,
  outcome text not null default '',
  digest text
);
create index if not exists lane_ledger_at on lane_ledger(at);
-- The shadow sink (S3b, the plan's §3): what the engine would have filed, and
-- nothing else. It writes no projections and no proposals, so a shadow claim
-- cannot change what a person sees. Additive: an older service ignores it.
create table if not exists engine_shadow (
  claim_key text not null,
  type text not null,
  knowledge_key text not null,
  refs text not null default '[]',
  lane text not null,
  digest text,
  at text not null
);
create index if not exists engine_shadow_at on engine_shadow(at);

-- What retention deleted before the engine read it, by day, source and lane, so
-- I7's "expired unread is counted" is true (design §10.5).
create table if not exists lane_expired (
  day text not null,
  source text not null,
  lane text not null,
  count integer not null default 0,
  primary key (day, source, lane)
) without rowid;

`

/**
 * Tables a space snapshot leaves out: short-lived, and not part of a space's content.
 * `act_grants` is a grant's single-use ledger, valid for a minute: a restored
 * copy carries no grant that is still live. `act_previews` is a preview's
 * snapshot, the same: a restored copy carries no preview a press could spend.
 */
export const TRANSIENT_TABLES = Object.freeze(["write_receipts", "act_grants", "act_previews"])

/**
 * The columns `migrate` adds to a table an earlier build created (scale M2). It
 * is one list, because the digest that lets a second open skip the migration is
 * taken over it: a build that adds a column changes the digest, so its files
 * migrate.
 */
export const COLUMN_SPECS = Object.freeze([
  ["act_audit", [["outcome", "text"], ["item", "text"]]],
  // When a report last listed the plugin (lane 0188): missing means no report has listed it for a week.
  ["plugins", [["listed_at", "text"]]],
  ["plugin_consents", [["pause_code", "text"], ["declaration_changed", "integer not null default 0"]]],
  // What a job host says it can serve (lane 0189): null is a host that never said, so it claims as before.
  ["job_hosts", [["connectors", "text"], ["incapable", "text"]]],
  ["trait_holds", [["refs", "text"], ["attempted", "text"]]],
  // The refs one gate verdict was reached for (lane 0198, review L): a forget deletes
  // the rows a forgotten event is named in, so nothing derived from it stays cached.
  ["trait_reads", [["refs", "text"]]],
  ["meeting_proposals", [["held_until", "text"], ["held_attempts", "integer not null default 0"]]],
  // The gap a plugin answered on the last collection (lane 0195): `window-truncated` says it served less than asked.
  ["source_collections", [["more", "integer"], ["host", "text"], ["elsewhere_host", "text"], ["elsewhere_at", "text"], ["elsewhere_error", "text"], ["skipped", "text"], ["skipped_at", "text"], ["gap_reason", "text"], ["gap_since", "text"], ["since_sent", "text"]]],
  // History import (lane 0195): the anchor `events.cursor` returns while no cursor is saved, the days it covers, and how it was
  // made (`bind` or `import`). All nullable and never read by 0.15.10, so a rollback opens the file and an older service writes the row.
  ["sources", [["asked_account", "text"], ["first_since", "text"], ["history_days", "integer"], ["history_via", "text"]]],
  ["claims", [["quotes", "text not null default '{}'"], ["statements", "text not null default '{}'"], ["shared_quotes", "text not null default '[]'"], ["shared_statements", "text not null default '[]'"], ["authors", "text not null default '{}'"]]],
  [
    "events",
    [
      ["removed_at", "text"],
      ["retract_pending", "integer"],
      ["retract_after", "text"],
      ["retract_url", "text"],
      ["meta", "text"],
      ["seq", "integer"],
      ["lane", "text"],
      ["content_hash", "text"],
      ["reentry_day", "text"],
      ["reentry_count", "integer"],
      // A page read from a history anchor or an import (lane 0195b): its events arrive now but occurred before the window the
      // person agreed to, so they are not late arrivals for a past day and the routine does not journal them.
      ["history", "integer"],
    ],
  ],
])

/** Every table the additive schema creates, so a cached open can prove they are all there. */
/** Every index the additive schema creates, for the same proof. */
export const ADDITIVE_INDEXES = Object.freeze([...ADDITIVE.matchAll(/create index if not exists ([a-z_]+)/g)].map((match) => match[1]))

export const ADDITIVE_TABLES = Object.freeze([...ADDITIVE.matchAll(/create table if not exists ([a-z_]+)/g)].map((match) => match[1]))

/** What a build's migration produces, as one digest: the additive schema and every column it adds. */
export const ADDITIVE_DIGEST = `sha256:${createHash("sha256").update(`${ADDITIVE}\u0000${JSON.stringify(COLUMN_SPECS)}`).digest("hex")}`

/**
 * The migration's own counters, so a test can see that a cached open ran no
 * statement (scale M2).
 */
const STATS = { runs: 0, skipped: 0, statements: 0 }
export function migrateStats() {
  return { ...STATS }
}
export function resetMigrateStats() {
  STATS.runs = 0
  STATS.skipped = 0
  STATS.statements = 0
}

/** Bring a freshly opened database to the current schema. Returns the version. */
export function migrate(db) {
  // The cached check (scale M2): a file this build has already brought up to
  // date is left alone, so a second open runs no statement at all. The digest
  // covers the additive schema and every column this build adds, so a build with
  // a new column, or a file from an older or newer build, still migrates.
  const before = metaState(db)
  const protectedSilver = before.version === SILVER_PROTECTION_VERSION &&
    db.prepare("select value from meta where key = 'silver_build'").get()?.value === SILVER_BUILD
  if (before.version > SCHEMA_VERSION && !protectedSilver) {
    throw new Error(`records: this space file has schema version ${before.version}, newer than this service (${SCHEMA_VERSION}); upgrade the service`)
  }
  const upToDate = (before.version === SCHEMA_VERSION || protectedSilver) && before.digest === ADDITIVE_DIGEST && before.tables
  if (upToDate) {
    STATS.skipped += 1
    return before.version
  }
  STATS.runs += 1
  const exec = (sql) => {
    STATS.statements += 1
    db.exec(sql)
  }
  const version = protectedSilver ? before.version : migrateVersions(db, exec)
  // `act_previews` gained its host and its replacement record while 0.11 was
  // unreleased, so a file an earlier build of this branch opened holds the
  // older shape. Its rows are a few minutes' previews and never a change to
  // anything a person owns, so the table is dropped rather than migrated: the
  // additive schema below recreates it, and a press whose preview this lost
  // asks for a fresh one, which is the honest answer.
  const previews = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'act_previews'").get()
  if (previews) {
    const columns = db.prepare("pragma table_info(act_previews)").all().map((column) => column.name)
    if (!columns.includes("host")) exec("drop table act_previews")
  }
  // The engine's columns (S3a) are added **before** the additive schema, because
  // its partial index `events_lane` names them; and a partial index an earlier
  // build of this branch created over the rows with no seq is dropped, because
  // enrolment now probes the `ingested_at` range instead (review M4).
  exec("drop index if exists events_seq_null")
  ensureColumns(db, "events", COLUMN_SPECS.find(([table]) => table === "events")[1])
  exec(ADDITIVE)
  // Every other column this build adds, in one list (`COLUMN_SPECS`): a table an
  // earlier build created without one gets it in place, and a table this file
  // does not have is skipped.
  // A plugins table that has no `listed_at` yet is one an earlier build wrote:
  // each plugin it holds was listed by the report that wrote it, and that report
  // was the latest of the only set it kept. Nothing may change on the day of the
  // deploy, so each such plugin is stamped as listed now (lane 0188). One update,
  // once: the column exists afterwards.
  const seed = hasTable(db, "plugins") && !columnsOf(db, "plugins").includes("listed_at")
  for (const [table, columns] of COLUMN_SPECS) {
    if (table === "events") continue
    if (!hasTable(db, table)) continue
    STATS.statements += 1
    ensureColumns(db, table, columns)
  }
  if (seed) {
    exec("update plugins set listed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') where state != 'missing'")
  }
  // The digest and the version are what the next open compares against.
  db.prepare("insert into meta (key, value) values ('additive_digest', ?) on conflict(key) do update set value = excluded.value").run(ADDITIVE_DIGEST)
  return version
}

/** A file's schema version, its migration digest, and whether it has the tables a build creates. */
function metaState(db) {
  const hasMeta = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'meta'").get()
  if (!hasMeta) return { version: 0, digest: null, tables: false }
  const row = db.prepare("select value from meta where key = 'schema_version'").get()
  const digest = db.prepare("select value from meta where key = 'additive_digest'").get()
  // Every additive table must be there: a snapshot a store took drops the
  // transient ones, and a cached open must not leave them dropped.
  const present = db.prepare(`select count(*) as n from sqlite_master where type = 'table' and name in (${ADDITIVE_TABLES.map(() => "?").join(", ")})`).get(...ADDITIVE_TABLES)
  const indexes = db.prepare(`select count(*) as n from sqlite_master where type = 'index' and name in (${ADDITIVE_INDEXES.map(() => "?").join(", ")})`).get(...ADDITIVE_INDEXES)
  return {
    version: row ? Number(row.value) : 0,
    digest: digest?.value ?? null,
    tables: Number(present?.n) === ADDITIVE_TABLES.length && Number(indexes?.n) === ADDITIVE_INDEXES.length,
  }
}

function hasTable(db, name) {
  return Boolean(db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name))
}

function columnsOf(db, table) {
  return db.prepare(`pragma table_info(${table})`).all().map((row) => row.name)
}

/** Add each column an existing table lacks; nothing else changes. */
function ensureColumns(db, table, columns) {
  const have = new Set(db.prepare(`pragma table_info(${table})`).all().map((row) => row.name))
  for (const [name, type] of columns) {
    if (!have.has(name)) db.exec(`alter table ${table} add column ${name} ${type}`)
  }
}

function migrateVersions(db, exec = (sql) => db.exec(sql)) {
  const hasMeta = db.prepare("select 1 from sqlite_master where type = 'table' and name = 'meta'").get()
  let version = 0
  if (hasMeta) {
    const row = db.prepare("select value from meta where key = 'schema_version'").get()
    version = row ? Number(row.value) : 0
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`records: this space file has schema version ${version}, newer than this service (${SCHEMA_VERSION}); upgrade the service`)
  }
  while (version < SCHEMA_VERSION) {
    exec("begin immediate")
    try {
      MIGRATIONS[version](db)
      version += 1
      db.prepare("insert into meta (key, value) values ('schema_version', ?) on conflict(key) do update set value = excluded.value").run(String(version))
      exec("commit")
    } catch (error) {
      exec("rollback")
      throw error
    }
  }
  return version
}
