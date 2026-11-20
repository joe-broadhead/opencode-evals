# tools-render-market-map
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: render_market_map (draws nothing here; the same data as a short table)
- Decision tested: A market-map render is called once, and the answer gives the same data as a table
- Data check: the thesis, companies and explore list are the user's own
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
render the market map for our AI infrastructure thesis with the companies we track and the ones to watch.

## Items
- [AFF-TR01] blocker · It used render_market_map once.
  evidence: call:affinity.render_market_map#1
- [AFF-PR01] major · It passed the thesis.
  evidence: call:affinity.render_market_map#1 args.thesis present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
