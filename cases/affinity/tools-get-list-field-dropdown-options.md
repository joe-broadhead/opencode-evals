# tools-get-list-field-dropdown-options
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_list_field_dropdown_options (the options of a dropdown field)
- Decision tested: A what-stages-are-there question is one dropdown read for the list field
- Data check: affinity: {{target:affinity.list}} has a stage dropdown
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what stages can a deal be in on our {{target:affinity.list}} list?

## Items
- [AFF-OC01] blocker · It used get_list_field_dropdown_options once.
  evidence: count:affinity.get_list_field_dropdown_options == 1
- [AFF-PR01] major · It read the list it resolved.
  evidence: call:affinity.get_list_field_dropdown_options#1 args.list_id present
- [AFF-OC03] major · The answer lists the options in order.
  evidence: text:any matches /(stage|option|term sheet|diligence)/i
