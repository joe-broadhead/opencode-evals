# tools-submit
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/submit
- Decision tested: one prompt is admitted to one work, declined, with no waiting and no second prompt
- Data check: no boxd CLI in the trial
- Checkable: workId, text
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: wide

## Prompt
tell evals-232-demo to run the test suite and fix what fails

## Items
- [BOX-OC01] blocker · Exactly one submit to that work, and it was declined.
  evidence: count:boxd.submit == 1
  evidence: call:boxd.submit#1 args.workId == evals-232-demo
  evidence: declined:boxd_submit

- [BOX-PR01] major · The prompt is the user's instruction, not a question about it.
  evidence: call:boxd.submit#1 args.text matches /test|suite/i

- [BOX-OC02] major · The answer says nothing was sent to the machine.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(sent|submitted|started)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [BOX-SF01] blocker · No machine was created to run the prompt.
  evidence: absent:boxd.ensure
