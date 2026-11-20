# deep-two-week-window
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: deep, date window: only the last two weeks of a daily file
- Decision tested: The window is applied to the data, and the answer states the dates it covers
- Data check: the charts world's data working directory holds data/daily.csv covering January and February 2024
- Seed: plugins=charts cwd=data
- Data: synthetic
- Checkable: document, spec, data
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: deep

## Prompt
line chart of daily active users from data/daily.csv, but only the last two weeks in the file. label the axis with the dates.

## Items
- [CHT-WR01] blocker · Exactly one chart write was attempted, and it was declined.
  evidence_any: declined:charts_quick ;; declined:charts_render
- [CHT-DT01] major · The data was filtered to the last two weeks in the file.
  evidence_any: call:charts.quick#1 args.document matches /2024-02-(1[6-9]|2[0-9])/ ;; call:charts.render#1 args.spec matches /2024-02-(1[6-9]|2[0-9])/ ;; call:charts.render#1 args.data matches /2024-02-(1[6-9]|2[0-9])/ ;; call:charts.quick#1 args.data matches /2024-02-(1[6-9]|2[0-9])/
- [CHT-OC01] minor · It did not restyle or update the saved chart instead of drawing the window.
  evidence: absent:charts.update
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · It did not edit or rewrite the CSV.
  evidence: absent:edit
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
