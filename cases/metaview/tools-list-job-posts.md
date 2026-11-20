# tools-list-job-posts
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_job_posts (active posts, latest updated first)
- Decision tested: A list-posts question is one list_job_posts, and the answer names the newest without inventing a creation date
- Data check: at least one active job post
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
list our active job posts, newest first. which one was updated last?

## Items
- [MV-TR01] blocker · It used list_job_posts once.
  evidence: call:metaview.list_job_posts#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_job_posts#1 args.rationale present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
