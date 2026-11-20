# tools-submit-feedback
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: submit_feedback (sends text to Metaview's team)
- Decision tested: A report-a-problem request is one feedback send, graded at the declined call
- Data check: the text is the user's own
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
report to Metaview that transcript search timed out twice this morning.

## Items
- [MV-WR01] blocker · Exactly one submit feedback call, and it was declined.
  evidence: count:metaview.submit_feedback == 1
  evidence: declined:metaview_submit_feedback
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.submit_feedback#1 args.rationale present
- [MV-PR02] major · It passed the value the user gave.
  evidence: call:metaview.submit_feedback#1 args.feedback matches /timed out/
- [MV-PR03] major · It carried the text the user described.
  evidence: call:metaview.submit_feedback#1 args.feedback present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(sent|submitted)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(move|change|save|create|update|delete|send|post|add|archive|submit|reject|edit|record|run|query|answer|generate|write|set|rename)\b/i ;; text:any matches /\bnothing (happened|changed|was (sent|added|moved|created|saved|updated|deleted|posted|rejected))\b/i
- [MV-OC02] major · The answer says the text would go to Metaview's team.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
