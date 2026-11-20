# tools-get-notes-for-entity
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_notes_for_entity (one record's notes)
- Decision tested: A what-do-our-notes-say-about-the-company question is one notes read for the record
- Data check: {{target:affinity.company}} has notes
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what notes do we have on {{target:affinity.company}}?

## Items
- [AFF-TR01] blocker · It used get_notes_for_entity once.
  evidence: call:affinity.get_notes_for_entity#1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_notes_for_entity#1 args.entity_id present
- [AFF-OC01] major · The answer reports the notes in its own words.
  evidence: text:any matches /(note|said|company)/i
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
