# tools-warm-intro
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: warm_intro (Affinity's warm intro playbook text)
- Decision tested: A find-me-a-warm-intro request calls the playbook once, then reads the relationships
- Data check: a path to {{target:affinity.company}} exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find me a warm intro to {{target:affinity.company}} and draft the ask.

## Items
- [AFF-TR01] blocker · It used warm_intro once.
  evidence: call:affinity.warm_intro#1
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
