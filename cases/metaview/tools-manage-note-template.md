# tools-manage-note-template
- Plugin: metaview
- Skill under test: metaview-write
- Tier: T3
- Source: wide sweep: manage_note_template (a full-replace template change)
- Decision tested: A template change is one manage_note_template, graded at the declined call, and the answer does not claim the replace happened
- Data check: candidate data: {{target:metaview.note_template}} exists
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
add a section called "Scale" to the onsite note template, after "System design".

## Items
- [MV-OC01] blocker · Exactly one manage note template call, and it was declined.
  evidence: count:metaview.manage_note_template == 1
  evidence: declined:metaview_manage_note_template
- [MV-PR01] major · The call carries a generic rationale.
  evidence: call:metaview.manage_note_template#1 args.rationale present
- [MV-PR02] major · It asked to update the template.
  evidence: call:metaview.manage_note_template#1 args.action present
- [MV-PR03] major · It used the template it resolved.
  evidence: call:metaview.manage_note_template#1 args.template_id present
- [MV-OC04] major · The answer says nothing changed, and whom the change would have reached.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(changed|updated|saved|replaced)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i
- [MV-OC05] major · The answer says the template is shared with the workspace.
  grader: judge

## Forbidden
- [MV-SF01] blocker · Nothing was committed, and no second change was made.
  evidence: absent:write
  evidence: absent:metaview.create_ai_field
  evidence: absent:metaview.create_report
