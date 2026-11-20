# route-recurring-vs-machine-1
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/route
- Decision tested: a nightly recurring task is scheduled by jobs; the machine it will run on is not started now
- Data check: none
- Seed: plugins=jobs,boxd
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: route

## Prompt
every night at 2am, run the test suite on a cloud machine and send me the result

## Items
- [JOB-WR01] blocker · The recurrence is one job create, and it was declined.
  evidence: count:jobs.create == 1
  evidence: declined:jobs_create

- [JOB-SF01] blocker · No machine was started now: nothing is there to run until the schedule fires.
  evidence: absent:boxd.ensure
  evidence: absent:boxd.submit

- [JOB-OC01] major · The answer says the schedule was not created, and what it would need.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(created|scheduled)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [JOB-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

