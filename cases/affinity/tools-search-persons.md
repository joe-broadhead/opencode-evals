# tools-search-persons
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_persons (people by name or email)
- Decision tested: A find-this-person question is one search_persons, and namesakes are shown, not merged
- Data check: the founder of {{target:affinity.company}} is tracked
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find the founder of {{target:affinity.company}} in the CRM.

## Items
- [AFF-TR01] blocker · It used search_persons once.
  evidence: call:affinity.search_persons#1
- [AFF-PR01] major · It searched on the name or email.
  evidence: call:affinity.search_persons#1 args.search_criteria present
- [AFF-OC01] major · The answer names the person and their company, and asks if several match.
  evidence: text:any matches /(found|match|company|which)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
