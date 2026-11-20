# tools-search-opportunities
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: search_opportunities (deals by term)
- Decision tested: A find-the-deal question is one search_opportunities
- Data check: affinity: at least one opportunity
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
search our deals for anything with 'seed' in the name.

## Items
- [AFF-OC01] blocker · It used search_opportunities once.
  evidence: count:affinity.search_opportunities == 1
- [AFF-PR01] major · It searched for the term.
  evidence: call:affinity.search_opportunities#1 args.term present
- [AFF-OC03] major · The answer lists the deals.
  evidence: text:any matches /(deal|seed|opportunity|none)/i
