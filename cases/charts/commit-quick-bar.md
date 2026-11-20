# commit-quick-bar
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: commit set: a real recipe render with its editable document
- Decision tested: The bar chart is really rendered from a typed document: one quick call, the PNG and the .chart.json on disk
- Data check: the charts world's data working directory holds data/sales.csv
- Seed: plugins=charts cwd=data
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: commit

## Prompt
quick bar chart of revenue by region from data/sales.csv, summed, saved with its editable document so I can restyle it later.

## Items
- [CHT-CT01] blocker · Exactly one quick call, and it was not declined.
  evidence: count:charts.quick == 1
  evidence: absent-declined:charts_quick
- [CHT-CT02] blocker · The PNG was written.
  evidence: file:outputs/charts/**/*.png exists
- [CHT-CT03] major · The editable document was written too.
  evidence: file:outputs/charts/**/*.chart.json exists
- [CHT-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · It did not fall back to a raw render.
  evidence: absent:charts.render
  evidence: absent:edit
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Commit plan: `charts.quick` is `local: true`: the write touches only the trial's own sandbox.
