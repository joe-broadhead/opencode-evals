# tools-create-field
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_field (a new CRM field)
- Decision tested: A new field is one create, graded at the declined call
- Data check: no field named 'Thesis fit' exists
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add a company field called "Thesis fit" as a single-select, with options strong, watch and pass.

## Items
- [AFF-WR01] blocker · Exactly one create field call, and it was declined.
  evidence: count:affinity.create_field == 1
  evidence: declined:affinity_create_field
- [AFF-PR01] major · It passed the value the user gave.
  evidence: call:affinity.create_field#1 args.name == "Thesis fit"
- [AFF-PR02] major · It created it for companies.
  evidence: call:affinity.create_field#1 args.entity_type present
- [AFF-OC01] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(created|added|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
