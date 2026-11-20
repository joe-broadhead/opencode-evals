# tools-create-report-p
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-create-report (lane L6b)
- Decision tested: A save-this-report request is one create_report with filters, graded at the declined call
- Data check: the workspace has conversations this quarter
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide, twin

## Prompt
build and keep a report that breaks down this quarter's interviews per interviewer, so colleagues can pull it up afterwards.

## Items
- [MV-WR01] blocker · Exactly one create report call, and it was declined.
  evidence: count:metaview.create_report == 1
  evidence: declined:metaview_create_report
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.create_report#1 args.rationale present
- [MV-PR02] major · It passed filters, an empty list for all.
  evidence: call:metaview.create_report#1 args.filters present
- [MV-PR03] major · It named the report.
  evidence: call:metaview.create_report#1 args.name present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|saved|added)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer says the report would be visible to the workspace.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
