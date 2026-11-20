# tools-get-person-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_person_info (one person's fields)
- Decision tested: A person-record question is one get_person_info by id
- Data check: the founder of {{target:affinity.company}} exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
pull up the founder of {{target:affinity.company}}'s record — role, company and how we know them.

## Items
- [AFF-TR01] blocker · It used get_person_info once.
  evidence: call:affinity.get_person_info#1
- [AFF-PR01] major · It read the person it resolved.
  evidence: call:affinity.get_person_info#1 args.person_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
