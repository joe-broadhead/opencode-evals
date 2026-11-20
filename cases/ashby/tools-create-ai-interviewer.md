# tools-create-ai-interviewer
- Plugin: ashby
- Skill under test: ashby-write
- Tier: T3
- Source: wave sweep: create_ai_interviewer (a new AI screening interviewer with an empty draft outline)
- Decision tested: A new AI interviewer is one create, graded at the declined call, with the title the user gave
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
create an AI interviewer called "Backend screen" for the backend role.

## Items
- [ASH-WR01] blocker · Exactly one create ai interviewer call, and it was declined.
  evidence: count:ashby.create_ai_interviewer == 1
  evidence: declined:ashby_create_ai_interviewer
- [ASH-PR01] major · The call carries a generic reason, with no candidate detail in it.
  evidence: call:ashby.create_ai_interviewer#1 args.reason present
- [ASH-PR02] major · It used the title the user gave.
  evidence: call:ashby.create_ai_interviewer#1 args.internalTitle == "Backend screen"
- [ASH-OC03] major · The answer says nothing changed.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|updated|changed|saved|published)\b/i ;; text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i ;; text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(create|add|move|change|save|update|delete|send|post|archive|submit|edit|write|set|publish)\b/i
- [ASH-OC04] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing was committed.
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
The role is in the prompt; the tool takes the title and a reason.
