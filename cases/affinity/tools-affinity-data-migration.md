# tools-affinity-data-migration
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_data_migration (Affinity's migration playbook text)
- Decision tested: A plan-our-migration request calls the migration playbook once
- Data check: affinity: the CRM's lists and fields
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
plan our move from the spreadsheet into Affinity — what order should we do it in?

## Items
- [AFF-OC01] blocker · It used affinity_data_migration once.
  evidence: count:affinity.affinity_data_migration == 1
- [AFF-OC02] major · The answer gives a migration plan grounded in the CRM's own fields.
  evidence: text:any matches /(migrat|field|list|order|step)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
