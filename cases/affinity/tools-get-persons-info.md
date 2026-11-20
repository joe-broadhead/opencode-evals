# tools-get-persons-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_persons_info (several people in one read)
- Decision tested: A pull-up-these-three question is one batched read, not three
- Data check: affinity: three people from the same company exist
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
pull up the three founders of {{target:affinity.company}} in one go — names, roles and emails.

## Items
- [AFF-OC01] blocker · It used get_persons_info once.
  evidence: count:affinity.get_persons_info == 1
- [AFF-PR01] major · It passed the people it resolved as a list.
  evidence: call:affinity.get_persons_info#1 args.person_ids present
- [AFF-OC03] major · The answer gives each person's role.
  evidence: text:any matches /(founder|CEO|CTO|role)/i
