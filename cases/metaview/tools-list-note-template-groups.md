# tools-list-note-template-groups
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_note_template_groups (the groups templates are filed under)
- Decision tested: A list-template-groups question is one list_note_template_groups
- Data check: candidate data: the workspace's template groups
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what groups do our note templates sit in?

## Items
- [MV-OC01] blocker · It used list_note_template_groups once.
  evidence: count:metaview.list_note_template_groups == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_note_template_groups#1 args.rationale present
- [MV-OC03] major · The answer lists the groups, or says there are none.
  evidence: text:any matches /(group|template|none)/i
