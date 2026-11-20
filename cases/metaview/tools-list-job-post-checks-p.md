# tools-list-job-post-checks-p
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-list-job-post-checks (lane L6b)
- Decision tested: A which-checks question is one list_job_post_checks for the post
- Data check: the platform engineer job post has checks
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide, twin

## Prompt
which checks apply to the platform engineer posting?

## Items
- [MV-TR01] blocker · It used list_job_post_checks once.
  evidence: call:metaview.list_job_post_checks#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_job_post_checks#1 args.rationale present
- [MV-PR02] major · It read the post it resolved.
  evidence: call:metaview.list_job_post_checks#1 args.job_post_id present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
