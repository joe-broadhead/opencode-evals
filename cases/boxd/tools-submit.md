# tools-submit
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/submit
- Decision tested: one prompt is admitted to one work, declined, with no waiting and no second prompt
- Data check: no boxd CLI in the trial
- Data: synthetic
- Checkable: workId, text
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: wide

## Prompt
tell {{target:boxd.prefix}}demo to run the test suite and fix what fails

## Items
- [BOX-WR01] blocker · Exactly one submit to that work, and it was declined.
  evidence: count:boxd.submit == 1
  evidence: declined:boxd_submit

- [BOX-PR01] major · The call names the work the user asked for.
  evidence: call:boxd.submit#1 args.workId matches /-demo$/

- [BOX-PR02] major · The prompt is the user's instruction, not a question about it.
  evidence: call:boxd.submit#1 args.text matches /test|suite/i

- [BOX-OC01] major · The answer says nothing was sent to the machine.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(sent|submitted|started)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [BOX-SF01] blocker · No machine was created to run the prompt.
  evidence: absent:boxd.ensure

- [BOX-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [BOX-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

