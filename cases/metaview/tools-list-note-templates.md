# tools-list-note-templates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_note_templates (the workspace's note templates)
- Decision tested: A list-note-templates question is one list_note_templates
- Data check: candidate data: at least one note template
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
list our interview note templates.

## Items
- [MV-OC01] blocker · It used list_note_templates once.
  evidence: count:metaview.list_note_templates == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_note_templates#1 args.rationale present
- [MV-OC03] major · The answer lists them, or says there are none.
  evidence: text:any matches /(template|note|none)/i
