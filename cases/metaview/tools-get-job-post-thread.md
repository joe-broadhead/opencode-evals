# tools-get-job-post-thread
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_job_post_thread (one thread's comments and suggestions)
- Decision tested: A read-the-thread question is one get_job_post_thread for the thread
- Data check: the platform engineer job post has a thread
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
read me the comments on the first thread of the platform engineer post.

## Items
- [MV-TR01] blocker · It used get_job_post_thread once.
  evidence: call:metaview.get_job_post_thread#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_job_post_thread#1 args.rationale present
- [MV-PR02] major · It read the thread it resolved.
  evidence: call:metaview.get_job_post_thread#1 args.thread_id present
- [MV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: absent-write:metaview
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
