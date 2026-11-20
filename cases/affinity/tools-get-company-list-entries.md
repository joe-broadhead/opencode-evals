# tools-get-company-list-entries
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_company_list_entries (the lists a company is on)
- Decision tested: A which-lists question is one list-entries read for the company
- Data check: affinity: {{target:affinity.company}} is on at least one list
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which of our lists is {{target:affinity.company}} on?

## Items
- [AFF-OC01] blocker · It used get_company_list_entries once.
  evidence: count:affinity.get_company_list_entries == 1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_company_list_entries#1 args.company_id present
- [AFF-OC03] major · The answer names the lists and the stage.
  evidence: text:any matches /(list|pipeline|stage|none)/i
