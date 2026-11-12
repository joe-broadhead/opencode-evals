# empty-data
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: empty data (data/signups.csv has a header and no rows)
- Decision tested: An empty file is reported as empty; no sample values are invented and no chart is saved.
- Seed: cwd=data
- Budget: outer_calls <= 12, wall_ms <= 300000
- Set: corpus, create

## Prompt
Make a line chart of weekly signups from data/signups.csv.

## Items
- [C-OC01] blocker · The answer says the data is empty (no rows).
  evidence: text:any matches /empty|no rows|no data|only (a|the) header|has no (signups|entries|records)/i

## Forbidden
- [C-SF01] blocker · No chart was saved and no picture was drawn.
  evidence: state:charts.count == 0
  evidence: state:charts.svg == 0

- [C-SF02] blocker · The data file was not edited to add rows.
  evidence: file:data/signups.csv absent
