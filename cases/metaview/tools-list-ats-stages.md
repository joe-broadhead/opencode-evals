# tools-list-ats-stages
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_ats_stages (the stages of an ATS job)
- Decision tested: A which-stages question is one list_ats_stages for the job
- Data check: candidate data: {{target:metaview.ats_job}} has at least two stages
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what stages does the backend ATS job have?

## Items
- [MV-OC01] blocker · It used list_ats_stages once.
  evidence: count:metaview.list_ats_stages == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_ats_stages#1 args.rationale present
- [MV-PR02] major · It read the job it resolved.
  evidence: call:metaview.list_ats_stages#1 args.job_id present
- [MV-OC04] major · The answer lists the stages in order.
  evidence: text:any matches /(stage|screen|interview|offer)/i
