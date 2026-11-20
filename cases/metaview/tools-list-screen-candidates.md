# tools-list-screen-candidates
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_screen_candidates (who is in a screen, by stage)
- Decision tested: A who-is-in-the-screen question is one list with the stage filter
- Data check: the data engineer screen has candidates
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
who's in the data engineer screen, and what stage is each at?

## Items
- [MV-TR01] blocker · It used list_screen_candidates once.
  evidence: call:metaview.list_screen_candidates#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_screen_candidates#1 args.rationale present
- [MV-PR02] major · It read the screen it resolved.
  evidence: call:metaview.list_screen_candidates#1 args.screen_id present
- [MV-OC01] major · The answer lists candidates with their stage.
  evidence: text:any matches /(stage|candidate|none)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
