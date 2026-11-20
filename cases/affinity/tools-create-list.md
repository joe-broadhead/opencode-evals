# tools-create-list
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_list (a new list)
- Decision tested: A new list is one create, graded at the declined call
- Data check: affinity: no list named 'Q1 pipeline' exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
create a new company list called "Q1 pipeline".

## Items
- [AFF-OC01] blocker · Exactly one create list call, and it was declined.
  evidence: count:affinity.create_list == 1
  evidence: declined:affinity_create_list
- [AFF-PR01] major · It used the name the user gave.
  evidence: call:affinity.create_list#1 args.name == Q1 pipeline
- [AFF-PR02] major · It made a company list.
  evidence: call:affinity.create_list#1 args.entity_type present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
