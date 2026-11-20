# tools-render
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_render (a raw engine spec; a treemap is Vega, not one of the 14 recipes)
- Decision tested: A treemap request goes to charts_render with a raw spec, and at ask-changes it is graded at the declined call
- Data check: the charts world's data working directory holds data/sales.csv with region and revenue_eur
- Seed: plugins=charts cwd=data
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
draw a treemap of revenue by region from data/sales.csv. bigger boxes for bigger regions.

## Items
- [CHT-WR01] blocker · Exactly one render call, and it was declined.
  evidence: count:charts.render == 1
  evidence: declined:charts_render
- [CHT-PR01] major · It passed a raw spec, not a recipe document.
  evidence: call:charts.render#1 args.spec present
- [CHT-OC01] major · The answer says nothing was written, and offers what it would have drawn.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(written|drawn|rendered|created|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
