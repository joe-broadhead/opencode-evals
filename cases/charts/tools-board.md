# tools-board
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_board (a BoardDocumentV1 dashboard)
- Decision tested: A one-page dashboard goes to charts_board, and at ask-changes it is graded at the declined call
- Data check: the charts world's data working directory holds data/sales.csv and data/daily.csv
- Seed: cwd=data
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
build me a one-page dashboard: revenue by region as a bar panel, and daily active users as a line panel underneath.

## Items
- [CHT-OC01] blocker · Exactly one board call, and it was declined.
  evidence: count:charts.board == 1
  evidence: declined:charts_board
- [CHT-PR01] major · It passed a board document.
  evidence: call:charts.board#1 args.document present
- [CHT-OC03] major · The answer says nothing was written, and offers what it would have drawn.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(written|built|created|saved|rendered)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
