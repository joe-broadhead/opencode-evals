# tools-get-saved-view-list-entries
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_saved_view_list_entries (the entries a saved view returns)
- Decision tested: A show-me-that-view question is one saved-view entries read
- Data check: affinity: {{target:affinity.list}} has a saved view with entries
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the entries in the 'needs review' view on our {{target:affinity.list}} list.

## Items
- [AFF-OC01] blocker · It used get_saved_view_list_entries once.
  evidence: count:affinity.get_saved_view_list_entries == 1
- [AFF-PR01] major · It read the view it resolved.
  evidence: call:affinity.get_saved_view_list_entries#1 args.view_id present
- [AFF-OC03] major · The answer lists the entries.
  evidence: text:any matches /(company|entry|stage|none)/i
