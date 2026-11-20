# tools-create-reminder
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_reminder (a reminder on a record)
- Decision tested: A reminder is one create_reminder, graded at the declined call
- Data check: affinity: {{target:affinity.person}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
remind me to follow up with {{target:affinity.person}} next Tuesday.

## Items
- [AFF-OC01] blocker · Exactly one create reminder call, and it was declined.
  evidence: count:affinity.create_reminder == 1
  evidence: declined:affinity_create_reminder
- [AFF-PR01] major · It attached the reminder to the person.
  evidence: call:affinity.create_reminder#1 args.entity_id present
- [AFF-PR02] major · It set the due date.
  evidence: call:affinity.create_reminder#1 args.due_date present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|set|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
