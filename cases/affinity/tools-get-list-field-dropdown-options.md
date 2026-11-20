# tools-get-list-field-dropdown-options
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_list_field_dropdown_options (the options of a dropdown field)
- Decision tested: A what-stages-are-there question is one dropdown read for the list field
- Data check: the pipeline has a stage dropdown
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what stages can a deal be in on list 424242 (our pipeline)?

## Items
- [AFF-TR01] blocker · It used get_list_field_dropdown_options once.
  evidence: call:affinity.get_list_field_dropdown_options#1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_list_field_dropdown_options#1 args.list_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
