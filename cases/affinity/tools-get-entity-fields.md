# tools-get-entity-fields
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entity_fields (the fields a record type supports)
- Decision tested: A which-fields question is one get_entity_fields for the type
- Data check: the CRM's company fields
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what fields do we keep on companies in Affinity?

## Items
- [AFF-TR01] blocker · It used get_entity_fields once.
  evidence: call:affinity.get_entity_fields#1
- [AFF-PR01] major · It asked for the company type.
  evidence: call:affinity.get_entity_fields#1 args.entity_type present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
