# tools-get-entity-field-dropdown-options
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entity_field_dropdown_options (the options of a record field)
- Decision tested: A what-sectors-are-there question is one dropdown read for the field
- Data check: a company dropdown field exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what options does our sector field have for companies?

## Items
- [AFF-TR01] blocker · It used get_entity_field_dropdown_options once.
  evidence: call:affinity.get_entity_field_dropdown_options#1
- [AFF-PR01] major · It asked for the sector field.
  evidence: call:affinity.get_entity_field_dropdown_options#1 args.field_id present
- [AFF-OC01] major · The answer lists the options.
  evidence: text:any matches /(option|sector|software|fintech)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
