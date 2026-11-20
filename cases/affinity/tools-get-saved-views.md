# tools-get-saved-views
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_saved_views (the saved views on a list)
- Decision tested: A what-views-are-there question is one get_saved_views for the list
- Data check: the pipeline has a saved view
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what saved views are on list 424242 (our pipeline)?

## Items
- [AFF-TR01] blocker · It used get_saved_views once.
  evidence: call:affinity.get_saved_views#1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_saved_views#1 args.list_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
