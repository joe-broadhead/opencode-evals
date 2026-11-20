# tools-list-job-post-checks
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_job_post_checks (the checks a post is judged by)
- Decision tested: A which-checks question is one list_job_post_checks for the post
- Data check: the platform engineer job post has checks
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
what checks does the platform engineer job post have?

## Items
- [MV-TR01] blocker · It used list_job_post_checks once.
  evidence: call:metaview.list_job_post_checks#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_job_post_checks#1 args.rationale present
- [MV-PR02] major · It read the post it resolved.
  evidence: call:metaview.list_job_post_checks#1 args.job_post_id present
- [MV-OC01] major · The answer names the checks.
  evidence: text:any matches /(check|title|inclusive|clarity)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
