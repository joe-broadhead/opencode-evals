# tools-get-single-list-entry
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_single_list_entry (one company's entry on one list)
- Decision tested: A show-me-the-entry question is one get_single_list_entry
- Data check: affinity: {{target:affinity.company}} is on {{target:affinity.list}}
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me {{target:affinity.company}}'s entry on the {{target:affinity.list}} list — stage, owner, the lot.

## Items
- [AFF-OC01] blocker · It used get_single_list_entry once.
  evidence: count:affinity.get_single_list_entry == 1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_single_list_entry#1 args.list_id present
- [AFF-OC03] major · The answer gives the entry's fields.
  evidence: text:any matches /(stage|owner|entry)/i
