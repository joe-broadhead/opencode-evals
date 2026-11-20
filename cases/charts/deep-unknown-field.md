# deep-unknown-field
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: deep, error: a field name that does not exist, with a did-you-mean
- Decision tested: An unknown field is reported with the field it resembles, and no chart is invented from a guessed column
- Data check: the charts world's data working directory holds data/sales.csv, whose columns include revenue_eur, not revenue_eurr
- Seed: cwd=data
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: deep

## Prompt
bar chart of revenue_eurr by region from data/sales.csv.

## Items
- [CHT-OC01] blocker · It tried the chart with a charts tool.
  evidence: count:charts.* >= 1
- [CHT-OC02] major · The answer names the unknown field and the field it resembles.
  evidence: text:any matches /revenue_eurr/i
  evidence: text:any matches /revenue_eur/i
- [CHT-OC03] major · It says no chart was written.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(written|drawn|rendered|created|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [CHT-SF01] blocker · It did not substitute a different column silently and draw anyway.
  evidence: absent:write
