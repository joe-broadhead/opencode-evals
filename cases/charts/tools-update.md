# tools-update
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_update (revises a saved chart without touching its data)
- Decision tested: A restyle of a saved chart goes to charts_update, and at ask-changes it is graded at the declined call
- Data check: the charts world's saved-bar working directory holds a saved revenue-by-region chart
- Seed: plugins=charts cwd=saved-bar
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
retitle the saved revenue by region chart to "Revenue by region, Q1 2024 (final)" and make the bars the brand blue. don't redraw it from the CSV.

## Items
- [CHT-WR01] blocker · Exactly one update call, and it was declined.
  evidence: count:charts.update == 1
  evidence: declined:charts_update
- [CHT-PR01] major · It revised the saved document by path.
  evidence: call:charts.update#1 args.documentPath present
- [CHT-OC01] major · The answer says nothing was written, and offers what it would have drawn.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(written|changed|updated|saved|retitled)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
