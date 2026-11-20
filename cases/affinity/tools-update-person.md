# tools-update-person
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: update_person (changes a person record)
- Decision tested: A person update is one call, graded at the declined call
- Data check: affinity: {{target:affinity.person}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add the email jordan.lee@example.com to {{target:affinity.person}}'s record.

## Items
- [AFF-OC01] blocker · Exactly one update person call, and it was declined.
  evidence: count:affinity.update_person == 1
  evidence: declined:affinity_update_person
- [AFF-PR01] major · It used the person it resolved.
  evidence: call:affinity.update_person#1 args.person_id present
- [AFF-PR02] major · It passed the email.
  evidence: call:affinity.update_person#1 args.emails present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(updated|changed|saved|added)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
