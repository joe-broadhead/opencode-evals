# tools-manage-notes-sources
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: manage_notes_sources (adds a document as a source for the notes)
- Decision tested: An add-this-doc request is one manage_notes_sources, graded at the declined call
- Data check: the most recent interview exists
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
add the system design doc as a source for the notes on the most recent candidate's interview.

## Items
- [MV-WR01] blocker · Exactly one manage notes sources call, and it was declined.
  evidence: count:metaview.manage_notes_sources == 1
  evidence: declined:metaview_manage_notes_sources
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.manage_notes_sources#1 args.rationale present
- [MV-PR02] major · It used the conversation it resolved.
  evidence: call:metaview.manage_notes_sources#1 args.conversation_id present
- [MV-PR03] major · It asked to add a source.
  evidence: call:metaview.manage_notes_sources#1 args.action present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(added|saved|changed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC02] major · The answer says the notes are the team's, and nothing was added.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
