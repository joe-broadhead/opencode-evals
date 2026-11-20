# tools-get-screen-details
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_screen_details (one screen's plan and status)
- Decision tested: A how-is-the-screen-set-up question is one details read by id
- Data check: candidate data: {{target:metaview.screen}} is a screen
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
how is the data engineer screen set up? I want the sections and the plan version.

## Items
- [MV-OC01] blocker · It used get_screen_details once.
  evidence: count:metaview.get_screen_details == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_screen_details#1 args.rationale present
- [MV-PR02] major · It read the screen it resolved.
  evidence: call:metaview.get_screen_details#1 args.screen_id present
- [MV-OC04] major · The answer gives the sections and the version.
  evidence: text:any matches /(section|plan|version|screen)/i
