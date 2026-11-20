# tools-manage-sequence
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: manage_sequence (enable, pause or edit outreach; set_enabled restarts everyone)
- Decision tested: A pause request is one manage_sequence, graded at the declined call, with whom it reaches stated
- Data check: the backend outreach sequence is enabled
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
pause the backend outreach sequence — we're changing the pitch.

## Items
- [MV-WR01] blocker · Exactly one manage sequence call, and it was declined.
  evidence: count:metaview.manage_sequence == 1
  evidence: declined:metaview_manage_sequence
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.manage_sequence#1 args.rationale present
- [MV-PR02] major · It passed the value the user gave.
  evidence: call:metaview.manage_sequence#1 args.action matches /pause|disable/
- [MV-PR03] major · It used the sequence it resolved.
  evidence: call:metaview.manage_sequence#1 args.sequence_id present
- [MV-OC01] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(paused|changed|disabled|saved)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC02] major · The answer says the sequence would stop for everyone enrolled.
  grader: judge
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
