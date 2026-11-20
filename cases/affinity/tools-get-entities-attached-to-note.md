# tools-get-entities-attached-to-note
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entities_attached_to_note (which records a note is on)
- Decision tested: A which-records-is-this-note-on question is one attached-entities read
- Data check: affinity: a note attached to at least one company
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which records is that note attached to — the one about the term sheet?

## Items
- [AFF-OC01] blocker · It used get_entities_attached_to_note once.
  evidence: count:affinity.get_entities_attached_to_note == 1
- [AFF-PR01] major · It read the note it resolved.
  evidence: call:affinity.get_entities_attached_to_note#1 args.note_id present
- [AFF-OC03] major · The answer names the records.
  evidence: text:any matches /(company|person|record|attached)/i
