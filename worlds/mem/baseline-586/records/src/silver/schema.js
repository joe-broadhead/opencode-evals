// A protected file is deliberately newer than every pre-Silver writer. Empty
// additive tables do not activate this version; the first write does, atomically.
export const SILVER_BUILD = "silver@1"
export const SILVER_PROTECTION_VERSION = 1_000_007

export const SILVER_SCHEMA = `
create table if not exists silver_fences (
  partition_key text primary key,
  generation integer not null
) without rowid;
create table if not exists silver_objects (
  object_key text primary key,
  partition_key text not null,
  source_key text not null,
  event_ref text not null,
  sequence integer not null,
  removed integer not null default 0,
  status text not null,
  fingerprint text,
  pending_proof text,
  fingerprint_expires text,
  observed_at text
) without rowid;
create index if not exists silver_objects_partition on silver_objects(partition_key);
create index if not exists silver_objects_ref on silver_objects(event_ref);
create index if not exists silver_objects_source on silver_objects(source_key);
create table if not exists silver_evidence (
  id text primary key,
  object_key text not null,
  part_key text not null,
  digest text,
  text text,
  anchored_at text not null,
  text_expires text not null,
  metadata_expires text not null,
  policy_version text,
  revision integer not null,
  active integer not null default 1
) without rowid;
create index if not exists silver_evidence_object on silver_evidence(object_key, part_key);
create index if not exists silver_evidence_expiry on silver_evidence(text_expires);
create table if not exists silver_memberships (
  object_key text not null,
  part_key text not null,
  evidence_id text not null,
  primary key (object_key, part_key, evidence_id)
) without rowid;
create index if not exists silver_memberships_evidence on silver_memberships(evidence_id);
create table if not exists silver_part_tombstones (
  object_key text not null,
  part_key text not null,
  reason text not null,
  primary key (object_key, part_key)
) without rowid;
create table if not exists silver_edges (
  derivative_id text not null,
  evidence_id text not null,
  primary key (derivative_id, evidence_id)
) without rowid;
create index if not exists silver_edges_evidence on silver_edges(evidence_id, derivative_id);
create table if not exists silver_receipts (
  object_key text not null,
  receipt_id text not null,
  digest text not null,
  outcome text not null,
  expires text not null,
  primary key (object_key, receipt_id)
) without rowid;
`

export const SILVER_TABLES = Object.freeze([...SILVER_SCHEMA.matchAll(/create table if not exists ([a-z_]+)/g)].map((match) => match[1]))
