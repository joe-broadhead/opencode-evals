# add-zoom
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: add x zoom to a saved temporal line chart
- Decision tested: Zoom is the x zoom preset on the saved line chart, added with charts_update, with an HTML page (the only format that carries it).
- Seed: cwd=saved-line
- Checkable: patch, formats
- Budget: outer_calls <= 14, wall_ms <= 420000
- Set: corpus, revise

## Prompt
Let me zoom into the time axis of the daily active users chart in outputs/charts/ in the browser.

## Items
- [C-PR01] blocker · It changed the saved chart with charts_update.
  evidence: call:charts.update#1

- [C-OC01] blocker · The new generation asks for x zoom.
  evidence: state:charts.has.zoom.x == true

- [C-OC02] blocker · An HTML page was written for it.
  evidence: file:outputs/charts/**/*.html exists

- [C-OC03] major · The data is unchanged: 60 daily rows.
  evidence: state:charts.count != 0
  evidence: state:charts.rows.count == 60

- [C-OC04] minor · The answer points to the HTML file.
  evidence: text:any matches /\.html/

## Notes
- The zoom itself is verified by the plugin's browser suite (recipe-x-zoom), not per run: this case grades that the agent asked for the supported preset and the format that carries it.
