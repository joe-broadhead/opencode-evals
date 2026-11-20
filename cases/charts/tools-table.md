# tools-table
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_table (a publication data-graphic table)
- Decision tested: A publication table goes to charts_table, and at ask-changes it is graded at the declined call
- Data check: the charts world's data working directory holds data/sales.csv
- Seed: cwd=data
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
make a publication table of the regions: revenue, share of total, and a small bar in the revenue column.

## Items
- [CHT-OC01] blocker · Exactly one table call, and it was declined.
  evidence: count:charts.table == 1
  evidence: declined:charts_table
- [CHT-PR01] major · It declared the table's columns.
  evidence: call:charts.table#1 args.columns present
- [CHT-OC03] major · The answer says nothing was written, and offers what it would have drawn.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(written|made|created|saved|rendered)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
