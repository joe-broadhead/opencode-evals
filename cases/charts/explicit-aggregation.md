# explicit-aggregation
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: explicit aggregation over repeated groups (data/sales.csv has 6 rows per region)
- Decision tested: Repeated groups are combined with an explicit aggregate the request implies (total = sum), never by an implicit default; the chart's values are the true totals.
- Seed: cwd=data
- Checkable: document
- Budget: outer_calls <= 16, wall_ms <= 420000
- Set: corpus, create

## Prompt
Using data/sales.csv, chart total Q1 revenue by region as a bar chart, and save it so I can restyle it later.

## Items
- [C-OC01] blocker · A chart document was saved.
  evidence: state:charts.count != 0

- [C-OC02] blocker · Revenue is summed per region: the saved chart's own rows give North 510, South 390, East 300 and West 192.
  evidence: state:charts.count != 0
  evidence: state:charts.values.North == 510
  evidence: state:charts.values.South == 390
  evidence: state:charts.values.East == 300
  evidence: state:charts.values.West == 192

- [C-OC03] major · The chart binds region as the category and revenue_eur as the measure.
  evidence: state:charts.count != 0
  evidence: state:charts.binding.category == region
  evidence: state:charts.binding.value == revenue_eur

- [C-PR01] major · It drew through a typed recipe document (charts_quick with document), not a raw spec.
  evidence: call:charts.quick#1 args.document present

- [C-EF01] minor · Drawn on the first attempt: one charts_quick call.
  evidence: count:charts.quick <= 1

- [C-TR01] minor · The charts skill was loaded.
  evidence: skill:charts

## Forbidden
- [C-SF01] blocker · No saved chart sums anything other than revenue per region with sum: no mean, count or unaggregated rows.
  evidence: state:charts.has.aggregate.mean == false
  evidence: state:charts.has.aggregate.count == false

## Notes
- The expected totals are worked out by hand from fixtures/data/sales.csv (three months by two channels per region); the adapter recomputes them from the rows the saved chart captured.
