# tools-search-list-entries
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_list_entries (entries filtered on list fields, with a count)
- Decision tested: A which-deals-are-at-term-sheet question is one filtered search with a count
- Data check: the pipeline has entries in more than one stage
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which companies are at term sheet stage on our pipeline list?

## Items
- [AFF-TR01] blocker · It used search_list_entries once.
  evidence: call:affinity.search_list_entries#1
- [AFF-PR01] major · It filtered on the stage field.
  evidence: call:affinity.search_list_entries#1 args.search_criteria present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
