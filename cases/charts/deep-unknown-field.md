# deep-unknown-field
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: deep, error: a field name that does not exist, with a did-you-mean
- Decision tested: An unknown field is reported with the field it resembles, and no chart is invented from a guessed column
- Data check: the charts world's data working directory holds data/sales.csv, whose columns include revenue_eur, not revenue_eurr
- Seed: plugins=charts cwd=data
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: deep

## Prompt
bar chart of revenue_eurr by region from data/sales.csv.

## Items
- [CHT-TR01] blocker · It tried the chart with a charts tool.
  evidence: call:charts.quick#1
- [CHT-ER01] major · The answer names the unknown field and the field it resembles.
  evidence: text:any matches /(did you mean|unknown field|no such field|not a (column|field))/i
- [CHT-OC01] major · It says no chart was written.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(written|drawn|rendered|created|saved)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · It did not substitute a different column silently and draw anyway.
  evidence: absent-write:charts
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
