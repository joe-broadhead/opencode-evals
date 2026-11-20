# tools-market-map-generator
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: market_map_generator (Affinity's market map text)
- Decision tested: A build-a-market-map request calls the generator once
- Data check: affinity: companies tracked by sector
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
build a market map for AI infrastructure — the categories and who's in each.

## Items
- [AFF-OC01] blocker · It used market_map_generator once.
  evidence: count:affinity.market_map_generator == 1
- [AFF-OC02] major · The answer gives the map as a table of categories and companies.
  evidence: text:any matches /(category|company|infrastructure|table|\|)/i

## Notes
- A playbook returns Affinity's workflow text; the case grades that the right routine was called and its steps were followed with reads.
