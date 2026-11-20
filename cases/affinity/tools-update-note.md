# tools-update-note
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: update_note (changes a note's text or links)
- Decision tested: A note edit is one update_note, graded at the declined call
- Data check: affinity: a note on {{target:affinity.company}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add a line to the note on {{target:affinity.company}}: "also wants an intro to the CTO."

## Items
- [AFF-OC01] blocker · Exactly one update note call, and it was declined.
  evidence: count:affinity.update_note == 1
  evidence: declined:affinity_update_note
- [AFF-PR01] major · It used the note it resolved.
  evidence: call:affinity.update_note#1 args.note_id present
- [AFF-PR02] major · It carried the new text.
  evidence: call:affinity.update_note#1 args.content present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(updated|changed|saved|added)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
