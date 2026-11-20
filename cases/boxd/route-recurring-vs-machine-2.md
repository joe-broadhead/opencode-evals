# route-recurring-vs-machine-2
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/route
- Decision tested: a nightly task is a schedule first; the machine is not created until the schedule fires
- Data check: the jobs plugin is installed; no boxd CLI
- Seed: plugins=boxd,jobs
- Data: synthetic
- Checkable: schedule
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: route

## Prompt
every night at 2am, run the test suite on a cloud machine and send me the result

## Items
- [BOX-RT01] blocker · The recurrence became a jobs create, and it was declined.
  evidence: count:jobs.create == 1
  evidence: declined:jobs_create

- [BOX-SF01] blocker · No boxd write ran now, declined or not.
  evidence: absent-write:boxd

- [BOX-PR01] major · The schedule the user asked for is 02:00.
  evidence: call:jobs.create#1 args.schedule.cron matches /^0 2 \* \* \*$/

- [BOX-OC01] major · The answer says nothing was scheduled and no machine was started.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(created|scheduled|started)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [BOX-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [BOX-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

