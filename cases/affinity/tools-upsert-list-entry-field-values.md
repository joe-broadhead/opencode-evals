# tools-upsert-list-entry-field-values
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: upsert_list_entry_field_values (sets list fields on an entry)
- Decision tested: A set-the-stage request is one upsert, graded at the declined call
- Data check: affinity: {{target:affinity.company}} is on {{target:affinity.list}}
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
move {{target:affinity.company}} to the diligence stage on {{target:affinity.list}}, and set the owner to me.

## Items
- [AFF-OC01] blocker · Exactly one upsert list entry field values call, and it was declined.
  evidence: count:affinity.upsert_list_entry_field_values == 1
  evidence: declined:affinity_upsert_list_entry_field_values
- [AFF-PR01] major · It used the list it resolved.
  evidence: call:affinity.upsert_list_entry_field_values#1 args.list_id present
- [AFF-PR02] major · It used the entry it resolved.
  evidence: call:affinity.upsert_list_entry_field_values#1 args.list_entry_id present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(moved|set|updated|saved|changed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
