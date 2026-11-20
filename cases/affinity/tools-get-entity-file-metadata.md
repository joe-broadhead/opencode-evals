# tools-get-entity-file-metadata
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entity_file_metadata (one file's size, type and dates)
- Decision tested: A what-is-that-file question is one metadata read
- Data check: affinity: a file exists on {{target:affinity.company}}
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what's the file we have on {{target:affinity.company}} — size, type and when it was uploaded?

## Items
- [AFF-OC01] blocker · It used get_entity_file_metadata once.
  evidence: count:affinity.get_entity_file_metadata == 1
- [AFF-PR01] major · It read the file it resolved.
  evidence: call:affinity.get_entity_file_metadata#1 args.file_id present
- [AFF-OC03] major · The answer gives the metadata.
  evidence: text:any matches /(size|type|upload|date)/i
