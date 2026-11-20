# tools-diagram
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_diagram (offline Mermaid or a structured recipe)
- Decision tested: A flowchart goes to charts_diagram with Mermaid source, and at ask-changes it is graded at the declined call
- Data check: none: the steps are the user's own
- Seed: cwd=data
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
draw a flowchart of our release steps: branch, CI, review, merge, tag, publish. put the review between CI and merge.

## Items
- [CHT-OC01] blocker · Exactly one diagram call, and it was declined.
  evidence: count:charts.diagram == 1
  evidence: declined:charts_diagram
- [CHT-PR01] major · It passed Mermaid source.
  evidence: call:charts.diagram#1 args.dsl present
- [CHT-OC03] major · The answer says nothing was written, and offers what it would have drawn.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(written|drawn|created|saved|rendered)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
