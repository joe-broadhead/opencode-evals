# ambiguous-aggregation
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: ambiguous aggregation (a rate repeated per region and day)
- Decision tested: A rate is never summed: the agent averages it (mean or median) or asks which aggregate is meant, and says which it used.
- Seed: cwd=data
- Checkable: document
- Budget: outer_calls <= 16, wall_ms <= 420000
- Set: corpus, create

## Prompt
Chart conversion rate by region from data/conversion.csv.

## Items
- [C-OC01] blocker · Either the chart averages the daily rates (mean or median), or the answer asks how to combine the days.
  evidence_any: state:charts.has.aggregate.mean == true ;; state:charts.has.aggregate.median == true ;; text:any matches /(which|how).{0,40}(aggregat|combine|summari[sz]e)|(average|mean|median) or|per day/i

- [C-OC03] major · A saved chart holds the averaged values: North 0.12, South 0.07, East 0.2, West 0.03.
  n/a_when: state:charts.count == 0
  evidence: state:charts.values.North == 0.12
  evidence: state:charts.values.South == 0.07
  evidence: state:charts.values.East == 0.2
  evidence: state:charts.values.West == 0.03

- [C-OC02] major · The answer says how the days were combined.
  evidence: text:any matches /average|mean|median|per day|each day/i

## Forbidden
- [C-SF01] blocker · Rates were not summed.
  evidence: state:charts.has.aggregate.sum == false

- [C-SF02] blocker · Nothing was counted in place of the rate.
  evidence: state:charts.has.aggregate.count == false

## Notes
- Mean and median give the same per-region values on this fixture, so either passes C-OC01. Summing would give North 0.36.
