# tools-manage-sourcing-knowledge
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: manage_sourcing_knowledge (workspace-scope knowledge sourcing uses)
- Decision tested: A knowledge change is one call, graded at the declined call
- Data check: candidate data: the workspace's sourcing knowledge
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
add our comp bands to the sourcing knowledge so the messages quote the right range.

## Items
- [MV-OC01] blocker · Exactly one manage sourcing knowledge call, and it was declined.
  evidence: count:metaview.manage_sourcing_knowledge == 1
  evidence: declined:metaview_manage_sourcing_knowledge
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.manage_sourcing_knowledge#1 args.rationale present
- [MV-PR02] major · It asked to create or update knowledge.
  evidence: call:metaview.manage_sourcing_knowledge#1 args.action present
- [MV-PR03] major · It carried the content the user described.
  evidence: call:metaview.manage_sourcing_knowledge#1 args.content present
- [MV-OC04] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(added|saved|changed)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC05] major · The answer says workspace-scope knowledge would change.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: absent:metaview.send_sourcing_message
  evidence: absent:metaview.give_sourcing_feedback
