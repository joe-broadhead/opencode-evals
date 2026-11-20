# tools-search-all-companies
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_all_companies (every match, for a count or an export)
- Decision tested: A how-many-companies question takes the count form, once, and answers with a number
- Data check: the CRM holds more companies than one page
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
how many companies do we track in Affinity in total? just the number.

## Items
- [AFF-TR01] blocker · It used search_all_companies once.
  evidence: call:affinity.search_all_companies#1
- [AFF-PR01] major · It asked for the count, not the rows.
  evidence: call:affinity.search_all_companies#1 args.total_count == true
- [AFF-OC01] major · The answer gives one number.
  evidence: text:any matches /\b[0-9,]+\b/
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · It did not page the whole list to count it.
  evidence: count:affinity.search_all_companies <= 1
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
