# tools-get-lists
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_lists (the CRM's lists)
- Decision tested: A list-our-lists question is one get_lists, optionally by term
- Data check: affinity: at least one list
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
list our pipeline lists in Affinity.

## Items
- [AFF-OC01] blocker · It used get_lists once.
  evidence: count:affinity.get_lists == 1
- [AFF-OC02] major · The answer names the lists.
  evidence: text:any matches /(list|pipeline|deal)/i
