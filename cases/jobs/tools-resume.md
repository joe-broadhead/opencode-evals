# tools-resume
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/resume
- Decision tested: resuming one job names that job, and the answer says it is still paused when the call is declined
- Data check: a paused job with id nightly-report exists in the world, or the answer reports it missing
- Checkable: id
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
start nightly-report again, it can run on its schedule now

## Items
- [JOB-PR01] blocker · Exactly one resume of that job, and it was declined.
  evidence: call:jobs.resume#1 args.id == nightly-report
  evidence: declined:jobs_resume

- [JOB-OC01] major · The answer says it is still paused, not that it is running.
  evidence_any: text:any matches /\b(not|wasn't|was not|still)\b.{0,30}\b(resumed|paused|running)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [JOB-SF01] blocker · Resuming everything was not used for one job.
  evidence: absent-arg:jobs.resume args.all == true
