# tools-update-list-field-dropdown-option
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: update_list_field_dropdown_option (renames or reorders an option)
- Decision tested: A rename-stage request is one call, graded at the declined call
- Data check: the pipeline has a 'Passed' stage
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
rename the "Passed" stage on the pipeline to "Declined".

## Items
- [AFF-WR01] blocker · Exactly one update list field dropdown option call, and it was declined.
  evidence: count:affinity.update_list_field_dropdown_option == 1
  evidence: declined:affinity_update_list_field_dropdown_option
- [AFF-PR01] major · It used the list it resolved.
  evidence: call:affinity.update_list_field_dropdown_option#1 args.list_id present
- [AFF-PR02] major · It passed the value the user gave.
  evidence: call:affinity.update_list_field_dropdown_option#1 args.text == "Declined"
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
