# tools-list-note-templates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_note_templates (the workspace's note templates)
- Decision tested: A list-note-templates question is one list_note_templates
- Data check: at least one note template
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
list our interview note templates.

## Items
- [MV-TR01] blocker · It used list_note_templates once.
  evidence: call:metaview.list_note_templates#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_note_templates#1 args.rationale present
- [MV-OC01] major · The answer lists them, or says there are none.
  evidence: text:any matches /(template|note|none)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
