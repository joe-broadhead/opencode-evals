# tools-get-list-fields
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_list_fields (the fields of one list)
- Decision tested: A which-fields-on-the-pipeline question is one get_list_fields for the list
- Data check: the pipeline exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what fields does our pipeline list have? I need the stage and the owner.

## Items
- [AFF-TR01] blocker · It used get_list_fields once.
  evidence: call:affinity.get_list_fields#1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_list_fields#1 args.list_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
