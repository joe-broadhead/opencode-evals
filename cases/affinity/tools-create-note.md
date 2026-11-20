# tools-create-note
- Plugin: affinity
- Skill under test: affinity-write
- Tier: T3
- Source: wide sweep: create_note (a note on records)
- Decision tested: A note is one create_note, graded at the declined call
- Data check: affinity: {{target:affinity.company}} exists
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
add a note to {{target:affinity.company}}: "Wants a warm intro to the platform team; follow up after their board meeting."

## Items
- [AFF-OC01] blocker · Exactly one create note call, and it was declined.
  evidence: count:affinity.create_note == 1
  evidence: declined:affinity_create_note
- [AFF-PR01] major · It carried the note text the user gave.
  evidence: call:affinity.create_note#1 args.content present
- [AFF-PR02] major · It attached the note to the company.
  evidence: call:affinity.create_note#1 args.company_ids present
- [AFF-OC04] major · The answer says nothing changed, and whom it would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(added|created|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [AFF-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
