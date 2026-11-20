# tools-list-screens
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_screens (the workspace's screening projects)
- Decision tested: A list-screens question is one list_screens
- Data check: candidate data: at least one screen
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
list our screening projects and whether they're active.

## Items
- [MV-OC01] blocker · It used list_screens once.
  evidence: count:metaview.list_screens == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_screens#1 args.rationale present
- [MV-OC03] major · The answer lists the screens and their state.
  evidence: text:any matches /(screen|active|archived|none)/i
