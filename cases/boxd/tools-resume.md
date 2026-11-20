# tools-resume
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/resume
- Decision tested: waking one work is one resume of that work, declined, and no second machine is created
- Data check: no boxd CLI in the trial
- Data: synthetic
- Checkable: workId
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
wake {{target:boxd.prefix}}demo, I need it again

## Items
- [BOX-WR01] blocker · Exactly one resume of that work, and it was declined.
  evidence: declined:boxd_resume

- [BOX-PR01] major · The call names the work the user asked for.
  evidence: call:boxd.resume#1 args.workId matches /-demo$/

- [BOX-OC01] major · The answer says it is not awake.
  evidence_any: text:any matches /\b(not|wasn't|was not|still)\b.{0,40}\b(awake|woken|running|hibernated)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [BOX-SF01] blocker · No ensure was used to recreate what resume should wake.
  evidence: absent:boxd.ensure

- [BOX-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [BOX-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

