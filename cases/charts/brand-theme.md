# brand-theme
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: a brand theme
- Decision tested: A brand is saved once as a named theme (charts_theme_save) and used by name, with the chart's data untouched.
- Seed: cwd=data
- Checkable: theme, name
- Budget: outer_calls <= 16, wall_ms <= 420000
- Set: corpus, create

## Prompt
Save our brand as a chart theme called acme-light, based on the light theme, with the series colours #0B5FFF, #FF6A3D and #00A87E. Then use it for a grouped bar chart of Q1 revenue by region, one bar per channel, from data/sales.csv.

## Items
- [C-OC01] blocker · The theme was saved as acme-light.
  evidence: call:charts.theme_save#1 args.name == acme-light
  evidence: file:.charts/themes/acme-light.json exists

- [C-OC02] blocker · The chart uses the saved theme.
  evidence: state:charts.count != 0
  evidence: state:charts.theme == acme-light

- [C-OC03] major · The theme file carries the three brand colours.
  evidence: file:.charts/themes/acme-light.json matches /0B5FFF[\s\S]*FF6A3D[\s\S]*00A87E/i

- [C-OC04] major · The chart is a grouped bar with region and channel and the per-channel totals (North Online 330, West Store 66).
  evidence: state:charts.count != 0
  evidence: state:charts.recipe == grouped_bar
  evidence: state:charts.values.North__Online == 330
  evidence: state:charts.values.West__Store == 66
