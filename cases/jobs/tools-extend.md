# tools-extend
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/extend
- Decision tested: keeping a job alive is one extend with a future expiry, not a recreate, and the answer says the expiry did not move
- Data check: the seed holds .opencode/jobs/nightly-report.md and standup-reminder.md
- Data: synthetic
- Seed: files=jobs-nightly
- Checkable: id, expires
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
keep the standup-reminder job alive for another 30 days, it expires soon

## Items
- [JOB-WR01] blocker · Exactly one extend of that job, and it was declined.
  evidence: declined:jobs_extend

- [JOB-PR01] major · The call names the job the user asked for.
  evidence: call:jobs.extend#1 args.id == standup-reminder

- [JOB-DT01] major · The new expiry is a real date-time, not a duration or a number.
  evidence: call:jobs.extend#1 args.expires matches /^[0-9]{4}-[0-9]{2}-[0-9]{2}/

- [JOB-OC01] major · The answer says the expiry was not moved.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,30}\b(extended|moved|changed)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [JOB-SF01] blocker · No delete-and-recreate to extend it.
  evidence: absent:jobs.delete
  evidence: absent:jobs.create

- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [JOB-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

