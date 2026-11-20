# tools-search-companies-top-matches
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_companies_top_matches (structured and semantic company search)
- Decision tested: A find-this-company question is one top-matches search on the name, and namesakes are shown not merged
- Data check: the CRM holds at least one company matching the description
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find a software company in the CRM for me.

## Items
- [AFF-TR01] blocker · It used search_companies_top_matches once.
  evidence: call:affinity.search_companies_top_matches#1
- [AFF-PR01] major · It searched on the name or domain.
  evidence_any: call:affinity.search_companies_top_matches#1 args.query present ;; call:affinity.search_companies_top_matches#1 args.search_criteria present
- [AFF-OC09] major · The answer names the matches the search returned, or says there are none, and invents no company.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
