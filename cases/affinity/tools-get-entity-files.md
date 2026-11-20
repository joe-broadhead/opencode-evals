# tools-get-entity-files
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entity_files (the files attached to a record)
- Decision tested: A what-files-do-we-have question is one files read for the record
- Data check: {{target:affinity.company}} has a file
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what files do we have on {{target:affinity.company}}?

## Items
- [AFF-TR01] blocker · It used get_entity_files once.
  evidence: call:affinity.get_entity_files#1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_entity_files#1 args.entity_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
