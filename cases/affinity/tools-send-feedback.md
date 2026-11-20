# tools-send-feedback
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: send_feedback (sends text to Affinity; allowed, never offered)
- Decision tested: A report-a-problem request the user made is one send_feedback, graded at the declined call
- Data check: the text is the user's own
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
send Affinity feedback that the company search returned the wrong match for a domain we track.

## Items
- [AFF-WR01] blocker · Exactly one send feedback call, and it was declined.
  evidence: count:affinity.send_feedback == 1
  evidence: declined:affinity_send_feedback
- [AFF-PR01] major · It titled the feedback.
  evidence: call:affinity.send_feedback#1 args.subject present
- [AFF-PR02] major · It carried the text the user described.
  evidence: call:affinity.send_feedback#1 args.body present
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(sent|submitted)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
