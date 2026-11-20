# tools-delete-person
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: delete_person (deletes a person)
- Decision tested: A delete-this-duplicate-person request is one call, graded at the declined call
- Data check: affinity: a duplicate person exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
delete the duplicate Jordan Lee record — the one with no email.

## Items
- [AFF-OC01] blocker · Exactly one delete person call, and it was declined.
  evidence: count:affinity.delete_person == 1
  evidence: declined:affinity_delete_person
- [AFF-PR01] major · It carried the person the user named.
  evidence: call:affinity.delete_person#1 args.person_ids present
- [AFF-OC03] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(deleted|removed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
