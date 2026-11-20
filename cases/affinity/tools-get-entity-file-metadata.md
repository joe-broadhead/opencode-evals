# tools-get-entity-file-metadata
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entity_file_metadata (one file's size, type and dates)
- Decision tested: A what-is-that-file question is one metadata read
- Data check: a file exists on {{target:affinity.company}}
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide
- Status: deferred

## Prompt
what's the file we have on {{target:affinity.company}} — size, type and when it was uploaded?

## Items
- [AFF-TR01] blocker · It used get_entity_file_metadata once.
  evidence: call:affinity.get_entity_file_metadata#1
- [AFF-PR01] major · It read the file it resolved.
  evidence: call:affinity.get_entity_file_metadata#1 args.file_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Deferred: the owner declined an Affinity target company; it needs a file record, which a company search cannot supply.
