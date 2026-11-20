# tools-render-market-map
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: render_market_map (draws nothing here; the same data as a short table)
- Decision tested: A market-map render is called once, and the answer gives the same data as a table
- Data check: affinity: the thesis, companies and explore list are the user's own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
render the market map for our AI infrastructure thesis with the companies we track and the ones to watch.

## Items
- [AFF-OC01] blocker · It used render_market_map once.
  evidence: count:affinity.render_market_map == 1
- [AFF-PR01] major · It passed the thesis.
  evidence: call:affinity.render_market_map#1 args.thesis present
- [AFF-OC03] major · The answer gives a short table, not an image.
  evidence: text:any matches /(\||table|company|thesis)/i
