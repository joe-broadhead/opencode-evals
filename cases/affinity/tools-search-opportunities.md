# tools-search-opportunities
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_opportunities (deals by term)
- Decision tested: A find-the-deal question is one search_opportunities
- Data check: at least one opportunity
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
search our deals for anything with 'seed' in the name.

## Items
- [AFF-TR01] blocker · It used search_opportunities once.
  evidence: call:affinity.search_opportunities#1
- [AFF-PR01] major · It searched for the term.
  evidence: call:affinity.search_opportunities#1 args.term present
- [AFF-OC09] major · The answer says nothing matched, and invents no deal.
  grader: judge
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
