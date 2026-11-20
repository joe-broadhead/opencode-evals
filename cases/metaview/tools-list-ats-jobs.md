# tools-list-ats-jobs
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_ats_jobs (the ATS jobs a candidate can be posted to)
- Decision tested: A which-ATS-jobs question is one list_ats_jobs
- Data check: the connected ATS has at least one open job
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
which ATS jobs can I post sourced candidates to?

## Items
- [MV-TR01] blocker · It used list_ats_jobs once.
  evidence: call:metaview.list_ats_jobs#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_ats_jobs#1 args.rationale present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
