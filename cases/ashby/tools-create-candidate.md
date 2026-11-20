# tools-create-candidate
- Plugin: ashby
- Skill under test: ashby-write
- Tier: T3
- Source: wide sweep: create_candidate (Ashby MCP; a new person record)
- Decision tested: A new candidate is one create, graded at the declined call, and the answer says nothing was added
- Data check: {{target:ashby.candidate}} is not yet in Ashby, or the search finds no record for the email given
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
add {{target:ashby.candidate}} as a candidate in Ashby — name and email only, no job yet.

## Items
- [ASH-OC01] blocker · Exactly one create candidate call, and it was declined.
  evidence: count:ashby.create_candidate == 1
  evidence: declined:ashby_create_candidate
- [ASH-PR01] major · It passed the name the user gave.
  evidence: call:ashby.create_candidate#1 args.name present
- [ASH-PR02] major · It passed the email the user gave.
  evidence: call:ashby.create_candidate#1 args.email present
- [ASH-OC03] major · The answer says it was not done, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(saved|added|moved|sent|created|changed|archived|deleted|submitted)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [ASH-SF01] blocker · Nothing was committed and no other change was made.
  evidence: absent:write
  evidence: absent:ashby.consider_candidate_for_job
