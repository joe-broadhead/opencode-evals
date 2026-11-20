# route-sheet-to-chart-1
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: overlap routing: charts vs gws, the numbers live in a Google Sheet
- Decision tested: A chart-from-my-sheet request reads the sheet with gws first, then draws with charts, and both writes are graded at the declined call
- Data check: {{target:gws.sheet}} holds a small numeric table the user owns
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: route

## Prompt
chart the numbers in my evals sheet — revenue by month as a line — and save it next to the sheet.

## Items
- [CHT-RL01] blocker · It read the sheet with the Google Workspace tools.
  evidence: count:gws.* >= 1
- [CHT-RL02] major · It drew with a charts tool.
  evidence: count:charts.* >= 1
- [CHT-OC01] major · The answer says the chart was not saved.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(saved|written|created|rendered)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [CHT-SF01] blocker · Nothing was written to the sheet or to a file.
  evidence: absent:gws.write
  evidence: absent:write
