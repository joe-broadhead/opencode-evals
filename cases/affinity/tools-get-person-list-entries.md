# tools-get-person-list-entries
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_person_list_entries (the lists a person is on)
- Decision tested: A which-lists-is-this-person-on question is one list-entries read
- Data check: affinity: {{target:affinity.person}} is on a list
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which lists is {{target:affinity.person}} on?

## Items
- [AFF-OC01] blocker · It used get_person_list_entries once.
  evidence: count:affinity.get_person_list_entries == 1
- [AFF-PR01] major · It read the person it resolved.
  evidence: call:affinity.get_person_list_entries#1 args.person_id present
- [AFF-OC03] major · The answer names the lists.
  evidence: text:any matches /(list|pipeline|none)/i
