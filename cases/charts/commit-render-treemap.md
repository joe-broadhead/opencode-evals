# commit-render-treemap
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: commit set: a real render to outputs/charts, inside the trial
- Decision tested: The treemap is really rendered: one render call, an SVG on disk, and no decline
- Data check: the charts world's data working directory holds data/sales.csv
- Seed: plugins=charts cwd=data
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: commit

## Prompt
draw a treemap of revenue by region from data/sales.csv and save the SVG.

## Items
- [CHT-CT01] blocker · Exactly one render call, and it was not declined.
  evidence: count:charts.render == 1
  evidence: absent-declined:charts_render
- [CHT-CT02] blocker · An SVG was written under outputs/charts.
  evidence: file:outputs/charts/**/*.svg exists
- [CHT-OC01] major · The answer shows the chart inline.
  evidence: text:any matches /!\[|\.svg/
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · No source file was edited.
  evidence: absent-write:charts
  evidence: absent:write
  evidence: absent:edit
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- Commit plan: `charts.render` is `local: true`: the write touches only the trial's own sandbox.
