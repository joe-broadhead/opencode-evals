# tools-list-screen-candidates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_screen_candidates (who is in a screen, by stage)
- Decision tested: A who-is-in-the-screen question is one list with the stage filter
- Data check: candidate data: {{target:metaview.screen}} has candidates
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
who's in the data engineer screen, and what stage is each at?

## Items
- [MV-OC01] blocker · It used list_screen_candidates once.
  evidence: count:metaview.list_screen_candidates == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_screen_candidates#1 args.rationale present
- [MV-PR02] major · It read the screen it resolved.
  evidence: call:metaview.list_screen_candidates#1 args.screen_id present
- [MV-OC04] major · The answer lists candidates with their stage.
  evidence: text:any matches /(stage|candidate|none)/i
