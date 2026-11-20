# tools-delete-list-field-dropdown-option
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: delete_list_field_dropdown_option (deletes an option)
- Decision tested: A delete-the-unused-stage request is one call, graded at the declined call
- Data check: affinity: {{target:affinity.list}} has an unused 'Passed' stage
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
delete the "Passed" stage from {{target:affinity.list}} — nothing uses it.

## Items
- [AFF-OC01] blocker · Exactly one delete list field dropdown option call, and it was declined.
  evidence: count:affinity.delete_list_field_dropdown_option == 1
  evidence: declined:affinity_delete_list_field_dropdown_option
- [AFF-PR01] major · It used the list it resolved.
  evidence: call:affinity.delete_list_field_dropdown_option#1 args.list_id present
- [AFF-PR02] major · It carried the option it resolved.
  evidence: call:affinity.delete_list_field_dropdown_option#1 args.dropdown_option_id present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(deleted|removed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
