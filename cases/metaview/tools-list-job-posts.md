# tools-list-job-posts
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: list_job_posts (active posts, latest updated first)
- Decision tested: A list-posts question is one list_job_posts, and the answer names the newest without inventing a creation date
- Data check: candidate data: at least one active job post
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
list our active job posts, newest first. which one was updated last?

## Items
- [MV-OC01] blocker · It used list_job_posts once.
  evidence: count:metaview.list_job_posts == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.list_job_posts#1 args.rationale present
- [MV-OC03] major · The answer names the newest post and says it is by update time.
  evidence: text:any matches /(updated|newest|job post)/i
