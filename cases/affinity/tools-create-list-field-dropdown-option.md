# tools-create-list-field-dropdown-option
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_list_field_dropdown_option (a new stage or option)
- Decision tested: A new stage is one create, graded at the declined call
- Data check: affinity: {{target:affinity.list}} has a stage field
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add a "Passed" stage to the {{target:affinity.list}} list, after term sheet.

## Items
- [AFF-OC01] blocker · Exactly one create list field dropdown option call, and it was declined.
  evidence: count:affinity.create_list_field_dropdown_option == 1
  evidence: declined:affinity_create_list_field_dropdown_option
- [AFF-PR01] major · It used the list it resolved.
  evidence: call:affinity.create_list_field_dropdown_option#1 args.list_id present
- [AFF-PR02] major · It used the option text the user gave.
  evidence: call:affinity.create_list_field_dropdown_option#1 args.text == Passed
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
