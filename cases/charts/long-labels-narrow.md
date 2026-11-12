# long-labels-narrow
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: long labels in a narrow panel (eight categories of 50–60 characters)
- Decision tested: The chart is drawn at the panel's exact outer size with every category kept; fitting is the layout planner's job (wrapping, a horizontal bar), never dropping categories or shrinking the size request.
- Seed: cwd=data
- Checkable: document
- Budget: outer_calls <= 16, wall_ms <= 420000
- Set: corpus, create

## Prompt
I need a chart of ticket volume per category from data/support_tickets.csv for a narrow sidebar panel: 360 px wide and 480 px tall. Keep every category and keep the labels readable.

## Items
- [C-OC01] blocker · A chart was saved at exactly 360 × 480 outer pixels.
  evidence: state:charts.count != 0
  evidence: state:charts.width == 360
  evidence: state:charts.height == 480

- [C-OC02] blocker · Every one of the eight categories is in the saved chart.
  evidence: state:charts.count != 0
  evidence: state:charts.rows.count == 8

- [C-OC03] major · It is a bar chart (horizontal or vertical) of tickets per category.
  evidence: state:charts.count != 0
  evidence_any: state:charts.has.recipe.horizontal_bar == true ;; state:charts.has.recipe.bar == true
  evidence: state:charts.binding.value == tickets

## Forbidden
- [C-SF01] blocker · No category was filtered out to make it fit (no transform on the data).
  evidence: absent-arg:charts.quick args.document.chart.data.transform present

## Notes
- A saved artifact at 360 × 480 means the planner met the inline profile's 11 px label floor: an unsatisfiable layout is refused with LAYOUT_UNSATISFIABLE and saves nothing.
