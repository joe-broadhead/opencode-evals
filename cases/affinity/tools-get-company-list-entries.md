# tools-get-company-list-entries
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_company_list_entries (the lists a company is on)
- Decision tested: A which-lists question is one list-entries read for the company
- Data check: {{target:affinity.company}} is on at least one list
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which of our lists is {{target:affinity.company}} on?

## Items
- [AFF-TR01] blocker · It used get_company_list_entries once.
  evidence: call:affinity.get_company_list_entries#1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_company_list_entries#1 args.company_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
