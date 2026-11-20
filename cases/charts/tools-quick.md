# tools-quick
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_quick (a standard recipe from a typed document)
- Decision tested: A standard bar chart goes to charts_quick with a document, and at ask-changes it is graded at the declined call
- Data check: the charts world's data working directory holds data/sales.csv
- Seed: cwd=data
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
quick bar chart of revenue by region from data/sales.csv, summed, with the euro sign in the axis label.

## Items
- [CHT-OC01] blocker · Exactly one quick call, and it was declined.
  evidence: count:charts.quick == 1
  evidence: declined:charts_quick
- [CHT-PR01] major · It used the typed document arm.
  evidence: call:charts.quick#1 args.document present
- [CHT-OC03] major · The answer says nothing was written, and offers what it would have drawn.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(written|drawn|rendered|created|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
