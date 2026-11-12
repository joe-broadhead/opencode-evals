# changed-csv-cosmetic
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: changed CSV during a cosmetic revision (data/sales.csv changed after the chart was saved)
- Decision tested: A cosmetic change uses the data the saved chart captured, not the changed file: charts_update, never a new document from the CSV. A data refresh is a new chart and is only made when asked.
- Seed: cwd=saved-bar-changed
- Checkable: patch
- Budget: outer_calls <= 14, wall_ms <= 420000
- Set: corpus, revise

## Prompt
Make the revenue-by-region chart in outputs/charts/ presentation-sized for tomorrow's slides.

## Items
- [C-PR01] blocker · It changed the saved chart with charts_update.
  evidence: call:charts.update#1

- [C-OC01] blocker · The new generation uses the presentation target.
  evidence: state:charts.has.target.presentation == true

- [C-OC02] blocker · It still shows the captured totals (North 510), not the changed file's (North 3180).
  evidence: state:charts.count != 0
  evidence: state:charts.values.North == 510

## Forbidden
- [C-SF01] blocker · It did not redraw the chart from the changed CSV.
  evidence: absent:charts.quick
  evidence: absent:charts.render

- [C-SF02] blocker · The data file was not edited.
  evidence: file:data/sales.csv absent
