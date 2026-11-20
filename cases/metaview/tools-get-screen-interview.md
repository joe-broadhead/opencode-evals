# tools-get-screen-interview
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_screen_interview (one candidate's screen interview)
- Decision tested: A show-me-the-screen-interview question is one get_screen_interview for the screen and candidate
- Data check: candidate data: {{target:metaview.candidate}} has a screen interview
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
show me {{target:metaview.candidate}}'s screen interview — the questions and how they answered.

## Items
- [MV-OC01] blocker · It used get_screen_interview once.
  evidence: count:metaview.get_screen_interview == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_screen_interview#1 args.rationale present
- [MV-PR02] major · It read the candidate it resolved.
  evidence: call:metaview.get_screen_interview#1 args.candidate_id present
- [MV-OC04] major · The answer summarises the interview and labels Metaview's notes as Metaview's.
  evidence: text:any matches /Metaview|question|answer/i
