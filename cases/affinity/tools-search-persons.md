# tools-search-persons
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_persons (people by name or email)
- Decision tested: A find-this-person question is one search_persons, and namesakes are shown, not merged
- Data check: affinity: {{target:affinity.person}} is tracked
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find {{target:affinity.person}} in the CRM.

## Items
- [AFF-OC01] blocker · It used search_persons once.
  evidence: count:affinity.search_persons == 1
- [AFF-PR01] major · It searched on the name or email.
  evidence: call:affinity.search_persons#1 args.search_criteria present
- [AFF-OC03] major · The answer names the person and their company, and asks if several match.
  evidence: text:any matches /(found|match|company|which)/i
