# tools-search-companies-top-matches
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_companies_top_matches (structured and semantic company search)
- Decision tested: A find-this-company question is one top-matches search on the name, and namesakes are shown not merged
- Data check: {{target:affinity.company}} is tracked
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find {{target:affinity.company}} in the CRM for me.

## Items
- [AFF-TR01] blocker · It used search_companies_top_matches once.
  evidence: call:affinity.search_companies_top_matches#1
- [AFF-PR01] major · It searched on the name or domain.
  evidence: call:affinity.search_companies_top_matches#1 args.search_criteria present
- [AFF-OC01] major · The answer names the company, with its domain, and asks if several match.
  evidence: text:any matches /(found|match|domain|which)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
