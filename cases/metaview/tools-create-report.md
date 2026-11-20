# tools-create-report
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: create_report (a saved workspace report)
- Decision tested: A save-this-report request is one create_report with filters, graded at the declined call
- Data check: the workspace has conversations this quarter
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
save a report of interviews by interviewer for this quarter, so the team can open it later.

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
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|saved|added)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC02] major · The answer says the report would be visible to the workspace.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
