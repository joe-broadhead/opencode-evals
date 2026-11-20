# tools-delete-list-entries
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: delete_list_entries (removes entries from a list)
- Decision tested: A remove-from-the-list request is one call, graded at the declined call
- Data check: affinity: {{target:affinity.company}} is on {{target:affinity.list}}
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
take {{target:affinity.company}} off the {{target:affinity.list}} list — they passed.

## Items
- [AFF-OC01] blocker · Exactly one delete list entries call, and it was declined.
  evidence: count:affinity.delete_list_entries == 1
  evidence: declined:affinity_delete_list_entries
- [AFF-PR01] major · It used the list it resolved.
  evidence: call:affinity.delete_list_entries#1 args.list_id present
- [AFF-PR02] major · It carried the entry it resolved.
  evidence: call:affinity.delete_list_entries#1 args.list_entry_ids present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(removed|deleted)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
