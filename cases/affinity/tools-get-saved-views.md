# tools-get-saved-views
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_saved_views (the saved views on a list)
- Decision tested: A what-views-are-there question is one get_saved_views for the list
- Data check: affinity: {{target:affinity.list}} has a saved view
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what saved views are on our {{target:affinity.list}} list?

## Items
- [AFF-OC01] blocker · It used get_saved_views once.
  evidence: count:affinity.get_saved_views == 1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_saved_views#1 args.list_id present
- [AFF-OC03] major · The answer names the views.
  evidence: text:any matches /(view|saved|none)/i
