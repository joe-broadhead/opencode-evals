# tools-warm-intro
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: warm_intro (Affinity's warm intro playbook text)
- Decision tested: A find-me-a-warm-intro request calls the playbook once, then reads the relationships
- Data check: affinity: a path to {{target:affinity.company}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find me a warm intro to {{target:affinity.company}} and draft the ask.

## Items
- [AFF-OC01] blocker · It used warm_intro once.
  evidence: count:affinity.warm_intro == 1
- [AFF-OC02] major · The answer names the path and drafts the ask.
  evidence: text:any matches /(intro|path|draft|ask|knows)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
