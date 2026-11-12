# scripted-probe-document
- Plugin: charts
- Skill under test: charts
- Tier: T1
- Source: harness probe: the scripted model makes one fixed charts_quick document call (through Code Mode's execute, as a model would), so the world, the run, the trace and the Charts grading adapter are exercised end to end with no model
- Decision tested: The pipeline grades a real saved chart: the adapter recomputes the totals from the artifact the run wrote.
- Seed: cwd=data
- Checkable: document
- Budget: outer_calls <= 4, wall_ms <= 180000
- Set: scripted

## Prompt
[[mock:tool:execute:{"code":"return await tools.charts.quick({document: {version: 1, chart: {kind: 'recipe', recipe: 'bar', data: {path: 'data/sales.csv'}, bindings: {category: 'region', value: 'revenue_eur'}, options: {aggregate: 'sum'}}, title: 'Revenue by region'}, name: 'probe'})"}]]

## Items
- [C-PR01] blocker · The scripted call reached charts_quick with a document.
  evidence: call:charts.quick#1 args.document present

- [C-OC01] blocker · One chart was saved, and its rows sum to the hand-computed totals.
  evidence: state:charts.count == 1
  evidence: state:charts.values.North == 510
  evidence: state:charts.values.West == 192

- [C-OC02] major · Its files are in one generation folder: SVG and PNG with the document.
  evidence: file:outputs/charts/probe-*/probe.chart.json exists
  evidence: file:outputs/charts/probe-*/probe.svg exists
