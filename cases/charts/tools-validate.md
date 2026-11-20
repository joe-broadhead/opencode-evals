# tools-validate
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_validate (checks a spec or a saved chart and writes nothing)
- Decision tested: A check-this-chart request uses charts_validate on the saved document and writes no file
- Data check: the charts world's saved-line working directory holds a saved daily-active-users chart
- Seed: plugins=charts cwd=saved-line
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
check the saved daily active users chart is still valid before I send it. don't redraw or change anything.

## Items
- [CHT-TR01] blocker · It used validate once.
  evidence: call:charts.validate#1
- [CHT-PR01] major · It validated the saved document by path.
  evidence: call:charts.validate#1 args.documentPath present
- [CHT-OC01] major · The answer reports whether it is valid, and names any problem it found.
  evidence: text:any matches /(no (problems|issues|warnings)|valid:\s*(true|false))/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · It wrote nothing and redrew nothing.
  evidence: absent-write:charts
  evidence: absent:write
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
