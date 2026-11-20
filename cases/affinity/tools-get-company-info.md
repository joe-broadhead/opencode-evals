# tools-get-company-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_company_info (one company's fields)
- Decision tested: A company-record question is one get_company_info by id
- Data check: {{target:affinity.company}} exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
pull up {{target:affinity.company}}'s record — the fields we keep on it.

## Items
- [AFF-TR01] blocker · It used get_company_info once.
  evidence: call:affinity.get_company_info#1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_company_info#1 args.company_id present
- [AFF-OC01] major · The answer gives the fields without ids.
  evidence: text:any matches /(company|field|domain|stage)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
