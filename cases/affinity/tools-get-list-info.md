# tools-get-list-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_list_info (one list's name and type)
- Decision tested: A what-is-this-list question is one get_list_info
- Data check: the pipeline exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what is the the pipeline list in Affinity — what's it for?

## Items
- [AFF-TR01] blocker · It used get_list_info once.
  evidence: call:affinity.get_list_info#1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_list_info#1 args.list_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
