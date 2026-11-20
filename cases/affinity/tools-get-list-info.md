# tools-get-list-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_list_info (one list's name and type)
- Decision tested: A what-is-this-list question is one get_list_info
- Data check: affinity: {{target:affinity.list}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what is the {{target:affinity.list}} list in Affinity — what's it for?

## Items
- [AFF-OC01] blocker · It used get_list_info once.
  evidence: count:affinity.get_list_info == 1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_list_info#1 args.list_id present
- [AFF-OC03] major · The answer gives the list's name and type.
  evidence: text:any matches /(list|type|company|opportunity)/i
