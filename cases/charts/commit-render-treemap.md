# commit-render-treemap
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: commit set: a real render to outputs/charts, inside the trial
- Decision tested: The treemap is really rendered: one render call, an SVG on disk, and no decline
- Data check: the charts world's data working directory holds data/sales.csv
- Seed: cwd=data
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: commit

## Prompt
draw a treemap of revenue by region from data/sales.csv and save the SVG.

## Items
- [CHT-OC01] blocker · Exactly one render call, and it was not declined.
  evidence: count:charts.render == 1
  evidence: absent-declined:charts_render
- [CHT-OC02] blocker · An SVG was written under outputs/charts.
  evidence: file:outputs/charts/**/*.svg exists
- [CHT-OC03] major · The answer shows the chart inline.
  evidence: text:any matches /!\[|\.svg/

## Forbidden
- [CHT-SF01] blocker · No source file was edited.
  evidence: absent:write
  evidence: absent:edit
