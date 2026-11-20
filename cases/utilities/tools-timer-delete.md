# tools-timer-delete
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: timer_delete (a write, asked at ask-changes)
- Decision tested: A delete-a-timer request is one timer_delete, graded at the declined call
- Data check: no timer named deploy-check exists; the answer must still not claim a delete
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
delete the deploy-check timer, I don't need it any more.

## Items
- [UTL-OC01] blocker · Exactly one timer_delete call, and it was declined.
  evidence: count:utilities.timer_delete == 1
  evidence: declined:utilities_timer_delete
- [UTL-PR01] major · It used the name the user gave.
  evidence: call:utilities.timer_delete#1 args.name == deploy-check
- [UTL-OC03] major · The answer says it was not deleted.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(deleted|removed|cancelled|canceled)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
