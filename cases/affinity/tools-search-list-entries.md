# tools-search-list-entries
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_list_entries (entries filtered on list fields, with a count)
- Decision tested: A which-deals-are-at-term-sheet question is one filtered search with a count
- Data check: affinity: {{target:affinity.list}} has entries in more than one stage
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which companies are at term sheet stage on our {{target:affinity.list}} list?

## Items
- [AFF-OC01] blocker · It used search_list_entries once.
  evidence: count:affinity.search_list_entries == 1
- [AFF-PR01] major · It filtered on the stage field.
  evidence: call:affinity.search_list_entries#1 args.search_criteria present
- [AFF-OC03] major · The answer lists them, and gives the count.
  evidence: text:any matches /(term sheet|stage|\b[0-9]+\b)/i
