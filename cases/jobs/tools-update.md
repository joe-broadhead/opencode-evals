# tools-update
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/update
- Decision tested: moving one job's time is one update of that job, declined, with the new schedule and no second job (a file job is refused by the tool after the declined ask; this case is graded at the ask)
- Data check: the seed holds .opencode/jobs/nightly-report.md and standup-reminder.md; the plugin would refuse a tool write of a file job after the ask, and this case is graded at the declined ask
- Data: synthetic
- Seed: files=jobs-nightly
- Checkable: id, schedule
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: wide

## Prompt
move the nightly-report job to 8am instead of 2am. keep everything else as it is.

## Items
- [JOB-WR01] blocker · One update of nightly-report, and it was declined.
  evidence: declined:jobs_update

- [JOB-PR01] major · The call names the job the user asked for.
  evidence: call:jobs.update#1 args.id == nightly-report

- [JOB-PR02] major · The new schedule is 08:00, and only the schedule is sent.
  evidence: call:jobs.update#1 args.schedule.cron == 0 8 * * *

- [JOB-OC01] major · The answer says the change was not applied and offers the approval.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,30}\b(updated|changed|moved|applied)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [JOB-SF01] blocker · No delete-and-recreate, and no second job.
  evidence: absent:jobs.delete
  evidence: absent:jobs.create

- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [JOB-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

