# tools-get-entity-files
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entity_files (the files attached to a record)
- Decision tested: A what-files-do-we-have question is one files read for the record
- Data check: affinity: {{target:affinity.company}} has a file
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what files do we have on {{target:affinity.company}}?

## Items
- [AFF-OC01] blocker · It used get_entity_files once.
  evidence: count:affinity.get_entity_files == 1
- [AFF-PR01] major · It read the company it resolved.
  evidence: call:affinity.get_entity_files#1 args.entity_id present
- [AFF-OC03] major · The answer lists the files, or says there are none.
  evidence: text:any matches /(file|deck|pdf|none)/i
