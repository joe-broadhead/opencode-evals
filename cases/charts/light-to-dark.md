# light-to-dark
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: light → dark on a saved chart
- Decision tested: A theme change is a charts_update of the saved chart document: a new generation in the dark theme with the same captured rows, bindings and aggregate.
- Seed: cwd=saved-bar
- Checkable: patch, expectedRevision
- Budget: outer_calls <= 14, wall_ms <= 420000
- Set: corpus, revise

## Prompt
The revenue-by-region chart under outputs/charts/ is for a dark dashboard. Switch it to the dark theme.

## Items
- [C-PR01] blocker · It changed the saved chart with charts_update.
  evidence: call:charts.update#1

- [C-OC01] blocker · The new generation is drawn in the dark theme.
  evidence: state:charts.has.mode.dark == true
  evidence: state:charts.theme == dark

- [C-OC02] blocker · Its analysis is unchanged: summed revenue per region, North 510 and West 192.
  evidence: state:charts.count != 0
  evidence: state:charts.aggregate == sum
  evidence: state:charts.values.North == 510
  evidence: state:charts.values.West == 192

- [C-PR02] major · The update named the revision it read (sha256:…).
  evidence: call:charts.update#1 args.expectedRevision matches /^sha256:[0-9a-f]{64}$/

## Forbidden
- [C-SF01] major · It did not redraw the chart from scratch with a new document.
  evidence: absent:charts.quick
  evidence: absent:charts.render

- [C-SF02] blocker · The saved chart's JSON was not edited by hand: no edit or write tool touched a .chart.json.
  evidence: absent-arg:edit args.filePath matches /\.chart\.json$/
  evidence: absent-arg:write args.filePath matches /\.chart\.json$/
