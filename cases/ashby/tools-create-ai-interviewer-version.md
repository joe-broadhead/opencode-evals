# tools-create-ai-interviewer-version
- Plugin: ashby
- Skill under test: ashby-write
- Tier: T3
- Source: wave sweep: create_ai_interviewer_version (a new draft version, blank or copied)
- Decision tested: A new draft version is one create, graded at the declined call, with the interviewer and source the user named
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
create a new blank draft version of AI interviewer ai_000000000000000000000000.

## Items
- [ASH-WR01] blocker · Exactly one create ai interviewer version call, and it was declined.
  evidence: count:ashby.create_ai_interviewer_version == 1
  evidence: declined:ashby_create_ai_interviewer_version
- [ASH-PR01] major · The call carries a generic reason, with no candidate detail in it.
  evidence: call:ashby.create_ai_interviewer_version#1 args.reason present
- [ASH-PR02] major · It used the interviewer the user named.
  evidence: call:ashby.create_ai_interviewer_version#1 args.aiInterviewerId == "ai_000000000000000000000000"
- [ASH-PR03] major · It asked for a blank version.
  evidence: call:ashby.create_ai_interviewer_version#1 args.source == "blank"
- [ASH-OC04] major · The answer says nothing changed.
  evidence_any: text:any matches /\b(not|nothing|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|updated|changed|saved|published)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
  evidence_any: text:any matches /\b(couldn't|could not|can't|cannot|unable to|not able to)\b.{0,40}\b(create|add|move|change|save|update|delete|send|post|archive|submit|edit|write|set|publish)\b/i
- [ASH-OC05] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing was committed.
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
