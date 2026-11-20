# tools-create-person
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_person (a new person record)
- Decision tested: A new person is one create_person, graded at the declined call
- Data check: affinity: the person is not yet tracked
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add Jordan Lee as a person in Affinity, email jordan.lee@example.com, at Acme Robotics.

## Items
- [AFF-OC01] blocker · Exactly one create person call, and it was declined.
  evidence: count:affinity.create_person == 1
  evidence: declined:affinity_create_person
- [AFF-PR01] major · It used the first name.
  evidence: call:affinity.create_person#1 args.first_name == Jordan
- [AFF-PR02] major · It passed the email.
  evidence: call:affinity.create_person#1 args.emails present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
