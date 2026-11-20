# tools-capabilities
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_capabilities (what this build can draw, computed)
- Decision tested: A what-works-here question uses charts_capabilities once and reports the engines and formats
- Data check: none
- Seed: plugins=charts
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what can you draw here, and which output formats actually work on this machine?

## Items
- [CHT-TR01] blocker · It used capabilities once.
  evidence: call:charts.capabilities#1
- [CHT-OC01] major · The answer names the engines and the formats that work.
  evidence: text:any matches /(vega|echarts|plot|svg|png|html)/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
