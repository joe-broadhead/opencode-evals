# tools-get-company-info
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_company_info (one company's fields)
- Decision tested: A company-record question is one get_company_info by id
- Data check: affinity: {{target:affinity.company}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
pull up {{target:affinity.company}}'s record — the fields we keep on it.

## Items
- [AFF-OC01] blocker · It used get_company_info once.
  evidence: count:affinity.get_company_info == 1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_company_info#1 args.company_id present
- [AFF-OC03] major · The answer gives the fields without ids.
  evidence: text:any matches /(company|field|domain|stage)/i
