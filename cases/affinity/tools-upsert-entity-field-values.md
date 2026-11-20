# tools-upsert-entity-field-values
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: upsert_entity_field_values (sets field values on a record)
- Decision tested: A set-the-field request is one upsert, graded at the declined call
- Data check: {{target:affinity.company}} exists and has the 'Thesis fit' field
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
set {{target:affinity.company}}'s thesis fit to "strong".

## Items
- [AFF-WR01] blocker · Exactly one upsert entity field values call, and it was declined.
  evidence: count:affinity.upsert_entity_field_values == 1
  evidence: declined:affinity_upsert_entity_field_values
- [AFF-PR01] major · It used the company it resolved.
  evidence: call:affinity.upsert_entity_field_values#1 args.entity_id present
- [AFF-PR02] major · It carried the field and value.
  evidence: call:affinity.upsert_entity_field_values#1 args.upserts present
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(set|updated|saved|changed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
