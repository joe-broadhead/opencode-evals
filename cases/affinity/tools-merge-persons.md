# tools-merge-persons
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: merge_persons (merges two person records)
- Decision tested: A person merge is one call, graded at the declined call
- Data check: affinity: two person records are duplicates
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
merge the duplicate Jordan Lee into the main one.

## Items
- [AFF-OC01] blocker · Exactly one merge persons call, and it was declined.
  evidence: count:affinity.merge_persons == 1
  evidence: declined:affinity_merge_persons
- [AFF-PR01] major · It named the record to keep.
  evidence: call:affinity.merge_persons#1 args.primary_person_id present
- [AFF-PR02] major · It named the record to merge in.
  evidence: call:affinity.merge_persons#1 args.duplicate_person_id present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(merged|combined)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
