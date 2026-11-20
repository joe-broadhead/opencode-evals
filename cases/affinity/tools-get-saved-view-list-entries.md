# tools-get-saved-view-list-entries
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_saved_view_list_entries (the entries a saved view returns)
- Decision tested: A show-me-that-view question is one saved-view entries read
- Data check: the pipeline has a saved view with entries
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the entries in the 'needs review' view on our pipeline list.

## Items
- [AFF-TR01] blocker · It used get_saved_view_list_entries once.
  evidence: call:affinity.get_saved_view_list_entries#1
- [AFF-PR01] major · It read the view it resolved.
  evidence: call:affinity.get_saved_view_list_entries#1 args.view_id present
- [AFF-OC01] major · The answer lists the entries.
  evidence: text:any matches /(company|entry|stage|none)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
