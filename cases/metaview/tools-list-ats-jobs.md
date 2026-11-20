# tools-list-ats-jobs
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_ats_jobs (the ATS jobs a candidate can be posted to)
- Decision tested: A which-ATS-jobs question is one list_ats_jobs
- Data check: candidate data: the connected ATS has at least one open job
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
which ATS jobs can I post sourced candidates to?

## Items
- [MV-OC01] blocker · It used list_ats_jobs once.
  evidence: count:metaview.list_ats_jobs == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_ats_jobs#1 args.rationale present
- [MV-OC03] major · The answer lists the jobs, or says the ATS has none or is not connected.
  evidence: text:any matches /(job|ATS|none|not connected)/i
