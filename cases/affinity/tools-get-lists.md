# tools-get-lists
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_lists (the CRM's lists)
- Decision tested: A list-our-lists question is one get_lists, optionally by term
- Data check: at least one list
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
list our pipeline lists in Affinity.

## Items
- [AFF-TR01] blocker · It used get_lists once.
  evidence: call:affinity.get_lists#1
- [AFF-OC01] major · The answer names the lists.
  evidence: text:any matches /(list|pipeline|deal)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
