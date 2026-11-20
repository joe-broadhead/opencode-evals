# tools-get-person-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_person_info (one person's fields)
- Decision tested: A person-record question is one get_person_info by id
- Data check: affinity: {{target:affinity.person}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
pull up {{target:affinity.person}}'s record — role, company and how we know them.

## Items
- [AFF-OC01] blocker · It used get_person_info once.
  evidence: count:affinity.get_person_info == 1
- [AFF-PR01] major · It read the person it resolved.
  evidence: call:affinity.get_person_info#1 args.person_id present
- [AFF-OC03] major · The answer gives the fields without ids.
  evidence: text:any matches /(role|company|email|person)/i
