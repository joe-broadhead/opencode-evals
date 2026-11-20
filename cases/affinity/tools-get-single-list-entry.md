# tools-get-single-list-entry
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_single_list_entry (one company's entry on one list)
- Decision tested: A show-me-the-entry question is one get_single_list_entry
- Data check: {{target:affinity.company}} is on the pipeline
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide
- Status: deferred

## Prompt
show me {{target:affinity.company}}'s entry on our pipeline — stage, owner, the lot.

## Items
- [AFF-TR01] blocker · It used get_single_list_entry once.
  evidence: call:affinity.get_single_list_entry#1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_single_list_entry#1 args.list_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Deferred: the owner declined an Affinity target company; it needs a list entry record, which a company search cannot supply.
