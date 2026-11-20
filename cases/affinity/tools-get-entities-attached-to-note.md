# tools-get-entities-attached-to-note
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wide sweep: get_entities_attached_to_note (which records a note is on)
- Decision tested: A which-records-is-this-note-on question is one attached-entities read
- Data check: note 424244 is attached to at least one company
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which records is note 424244 attached to — the one about the term sheet?

## Items
- [AFF-TR01] blocker · It used get_entities_attached_to_note once.
  evidence: call:affinity.get_entities_attached_to_note#1
- [AFF-PR01] major · It read the note it resolved.
  evidence: call:affinity.get_entities_attached_to_note#1 args.note_id present
- [AFF-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · Nothing committed.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
