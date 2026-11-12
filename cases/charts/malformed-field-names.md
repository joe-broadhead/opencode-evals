# malformed-field-names
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: malformed field names (the request misspells both columns)
- Decision tested: The agent binds the real columns (region, revenue_eur), repairing from the data or the tool's did-you-mean, rather than giving up or inventing columns.
- Seed: cwd=data
- Checkable: document
- Budget: outer_calls <= 16, wall_ms <= 420000
- Set: corpus, create

## Prompt
plot total revnue per regoin from data/sales.csv

## Items
- [C-OC01] blocker · A saved chart binds the real columns: region and revenue_eur.
  evidence: state:charts.count != 0
  evidence: state:charts.binding.category == region
  evidence: state:charts.binding.value == revenue_eur

- [C-OC02] major · The values are the per-region totals (North 510).
  evidence: state:charts.count != 0
  evidence: state:charts.values.North == 510

- [C-EF01] minor · At most one repair: no more than two chart calls.
  evidence: count:charts.quick <= 2
