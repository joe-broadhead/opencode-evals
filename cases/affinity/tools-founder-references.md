# tools-founder-references
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: founder_references (reference sources for a named person)
- Decision tested: A find-references request calls the routine once
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find reference-check sources for founder 424244.

## Items
- [AFF-TR01] blocker · It used founder_references once.
  evidence: call:affinity.founder_references#1
- [AFF-OC01] major · The answer gives the reference-check plan from the firm's records or the playbook, naming who to ask and why, not a restatement of the question.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
