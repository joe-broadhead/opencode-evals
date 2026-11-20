# tools-affinity-data-migration
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: affinity_data_migration (Affinity's migration playbook text)
- Decision tested: A plan-our-migration request calls the migration playbook once
- Data check: the CRM's lists and fields
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
plan our move from the spreadsheet into Affinity — what order should we do it in?

## Items
- [AFF-TR01] blocker · It used affinity_data_migration once.
  evidence: call:affinity.affinity_data_migration#1
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
