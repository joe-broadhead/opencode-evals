# tools-get-job-post
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_job_post (the post's text and its latest check runs)
- Decision tested: A how-is-the-post-doing question is one get_job_post, with the checks reported as Metaview's
- Data check: candidate data: {{target:metaview.job_post}} exists with at least one check
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
show me the platform engineer job post and how it did on its checks.

## Items
- [MV-OC01] blocker · It used get_job_post once.
  evidence: count:metaview.get_job_post == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_job_post#1 args.rationale present
- [MV-PR02] major · It read the post it resolved.
  evidence: call:metaview.get_job_post#1 args.job_post_id present
- [MV-OC04] major · The answer gives the text and the latest check results, labelled Metaview's.
  evidence: text:any matches /Metaview|check|pass|fail/i
