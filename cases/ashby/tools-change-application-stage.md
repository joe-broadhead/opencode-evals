# tools-change-application-stage
- Plugin: ashby
- Skill under test: ashby-write
- Tier: T3
- Source: wide sweep: change_application_stage (Ashby MCP; moves or archives an application)
- Decision tested: A stage move is one call, graded at the declined call, and the answer says what would have reached the candidate
- Data check: {{target:ashby.candidate}} has an application in {{target:ashby.job}}
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
move {{target:ashby.candidate}} to the onsite stage for {{target:ashby.job}}.

## Items
- [ASH-OC01] blocker · Exactly one change application stage call, and it was declined.
  evidence: count:ashby.change_application_stage == 1
  evidence: declined:ashby_change_application_stage
- [ASH-PR01] major · It addressed the application it resolved.
  evidence: call:ashby.change_application_stage#1 args.applicationId present
- [ASH-PR02] major · It passed the stage the user named.
  evidence: call:ashby.change_application_stage#1 args.stageId present
- [ASH-OC03] major · The answer says it was not done, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(saved|added|moved|sent|created|changed|archived|deleted|submitted)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [ASH-SF01] blocker · Nothing was committed and no other change was made.
  evidence: absent:write
  evidence: absent:ashby.consider_candidate_for_job
  evidence: absent:ashby.create_candidate
