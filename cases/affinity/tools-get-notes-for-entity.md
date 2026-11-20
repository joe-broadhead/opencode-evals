# tools-get-notes-for-entity
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_notes_for_entity (one record's notes)
- Decision tested: A what-do-our-notes-say-about-the-company question is one notes read for the record
- Data check: affinity: {{target:affinity.company}} has notes
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what notes do we have on {{target:affinity.company}}?

## Items
- [AFF-OC01] blocker · It used get_notes_for_entity once.
  evidence: count:affinity.get_notes_for_entity == 1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_notes_for_entity#1 args.entity_id present
- [AFF-OC03] major · The answer reports the notes in its own words.
  evidence: text:any matches /(note|said|company)/i
