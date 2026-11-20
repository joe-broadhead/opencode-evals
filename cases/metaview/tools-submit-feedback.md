# tools-submit-feedback
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: submit_feedback (sends text to Metaview's team)
- Decision tested: A report-a-problem request is one feedback send, graded at the declined call
- Data check: none: the text is the user's own
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
report to Metaview that transcript search timed out twice this morning.

## Items
- [MV-OC01] blocker · Exactly one submit feedback call, and it was declined.
  evidence: count:metaview.submit_feedback == 1
  evidence: declined:metaview_submit_feedback
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.submit_feedback#1 args.rationale present
- [MV-PR02] major · It chose a category.
  evidence: call:metaview.submit_feedback#1 args.category present
- [MV-PR03] major · It carried the text the user described.
  evidence: call:metaview.submit_feedback#1 args.feedback present
- [MV-OC04] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(sent|submitted)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC05] major · The answer says the text would go to Metaview's team.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: absent:metaview.create_report
  evidence: absent:metaview.give_sourcing_feedback
