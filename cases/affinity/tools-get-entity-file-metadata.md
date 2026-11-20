# tools-get-entity-file-metadata
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entity_file_metadata (one file's size, type and dates)
- Decision tested: A what-is-that-file question searches the files, takes the one it finds, and reads its metadata
- Data check: the CRM holds at least one file
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what's the most recent file we have — size, type and when it was uploaded?

## Items
- [AFF-TR01] blocker · It used get_entity_file_metadata once.
  evidence: call:affinity.get_entity_file_metadata#1
- [AFF-TR02] blocker · It searched the files first.
  evidence: call:affinity.search_files#1
- [AFF-PR01] major · It read the file it found.
  evidence: call:affinity.get_entity_file_metadata#1 args.file_id > 0
  evidence: before:affinity.search_files,affinity.get_entity_file_metadata
- [AFF-OC01] major · The answer reports the file's metadata the calls returned, or says there is none, and invents none.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- The harness cannot prove the file id came from the earlier read (`created` counts write results only); the before order and a non-empty id are the strongest code checks, and a judge settles provenance.
