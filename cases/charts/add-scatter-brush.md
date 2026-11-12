# add-scatter-brush
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: add interval brushing to a saved scatter plot
- Decision tested: Selecting points by dragging is the interval brush preset on the scatter, added with charts_update, with an HTML page.
- Seed: cwd=saved-scatter
- Checkable: patch, formats
- Budget: outer_calls <= 14, wall_ms <= 420000
- Set: corpus, revise

## Prompt
On the spend vs conversions scatter in outputs/charts/, I want to drag a box to select a group of campaigns.

## Items
- [C-PR01] blocker · It changed the saved chart with charts_update.
  evidence: call:charts.update#1

- [C-OC01] blocker · The new generation asks for the interval brush.
  evidence: state:charts.has.brush.interval == true

- [C-OC02] blocker · An HTML page was written for it.
  evidence: file:outputs/charts/**/*.html exists

- [C-OC03] major · The data and series are unchanged: 12 campaigns, coloured by channel.
  evidence: state:charts.count != 0
  evidence: state:charts.rows.count == "12"
  evidence: state:charts.binding.series == channel

## Notes
- The brush itself is verified by the plugin's browser suite (recipe-interval-brush), not per run.
