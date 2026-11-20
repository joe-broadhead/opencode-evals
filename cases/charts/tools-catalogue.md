# tools-catalogue
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_catalogue (every chart type, or one full example)
- Decision tested: A show-me-an-example request uses charts_catalogue for one type and returns its example
- Data check: none
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
show me your Sankey example — the full spec and the data, so I can adapt it.

## Items
- [CHT-OC01] blocker · It used catalogue once.
  evidence: count:charts.catalogue == 1
- [CHT-PR01] major · It asked for the Sankey type.
  evidence: call:charts.catalogue#1 args.id matches /sankey/i
- [CHT-OC03] major · The answer carries an example spec, not just a description.
  evidence: text:any matches /(spec|data|nodes|links)/i
