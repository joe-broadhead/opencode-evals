# tools-company-signals
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: company_signals (Affinity's signals routine)
- Decision tested: A what-signals-are-on-this-company request calls company_signals once
- Data check: affinity: {{target:affinity.company}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what signals are on {{target:affinity.company}} right now? hiring, funding, anything the CRM picked up.

## Items
- [AFF-OC01] blocker · It used company_signals once.
  evidence: count:affinity.company_signals == 1
- [AFF-OC02] major · The answer reports signals, labelled as Affinity's where they are.
  evidence: text:any matches /(signal|hiring|funding|Affinity)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
