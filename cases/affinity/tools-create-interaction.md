# tools-create-interaction
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_interaction (logs an interaction on people)
- Decision tested: A log-this-call request is one create_interaction, graded at the declined call
- Data check: affinity: {{target:affinity.person}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
log a call with {{target:affinity.person}} today: they're interested but want to see the next quarter's numbers.

## Items
- [AFF-OC01] blocker · Exactly one create interaction call, and it was declined.
  evidence: count:affinity.create_interaction == 1
  evidence: declined:affinity_create_interaction
- [AFF-PR01] major · It logged a call.
  evidence: call:affinity.create_interaction#1 args.interaction_type present
- [AFF-PR02] major · It carried the note the user gave.
  evidence: call:affinity.create_interaction#1 args.content present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(logged|created|saved|added)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
