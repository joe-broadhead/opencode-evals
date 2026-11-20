# tools-create-list-entry
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_list_entry (adds a record to a list)
- Decision tested: An add-to-the-list request is one create_list_entry, graded at the declined call
- Data check: affinity: {{target:affinity.company}} is not on {{target:affinity.list}}
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add {{target:affinity.company}} to our {{target:affinity.list}} list.

## Items
- [AFF-OC01] blocker · Exactly one create list entry call, and it was declined.
  evidence: count:affinity.create_list_entry == 1
  evidence: declined:affinity_create_list_entry
- [AFF-PR01] major · It used the list it resolved.
  evidence: call:affinity.create_list_entry#1 args.list_id present
- [AFF-PR02] major · It used the company it resolved.
  evidence: call:affinity.create_list_entry#1 args.entity_id present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(added|created|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
