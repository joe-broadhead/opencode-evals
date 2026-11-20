# tools-get-list-fields
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_list_fields (the fields of one list)
- Decision tested: A which-fields-on-the-pipeline question is one get_list_fields for the list
- Data check: affinity: {{target:affinity.list}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what fields does our {{target:affinity.list}} list have? I need the stage and the owner.

## Items
- [AFF-OC01] blocker · It used get_list_fields once.
  evidence: count:affinity.get_list_fields == 1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_list_fields#1 args.list_id present
- [AFF-OC03] major · The answer names the fields and their types.
  evidence: text:any matches /(stage|owner|field)/i
