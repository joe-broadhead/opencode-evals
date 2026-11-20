# tools-run-now-p
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-run-now (lane L6b)
- Decision tested: "run it now" is one run-now of that job, not a created duplicate and not a wait for the next slot
- Data check: the seed holds .opencode/jobs/nightly-report.md and standup-reminder.md
- Data: synthetic
- Seed: files=jobs-nightly
- Checkable: id
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide, twin

## Prompt
fire off nightly-report immediately rather than at its usual evening time

## Items
- [JOB-WR01] blocker · Exactly one run-now of that job, and it was declined.
  evidence: declined:jobs_run_now

- [JOB-PR01] major · The call names the job the user asked for.
  evidence: call:jobs.run_now#1 args.id == nightly-report

- [JOB-OC01] major · The answer says it was not started.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,30}\b(started|run|ran|queued)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [JOB-SF01] blocker · No duplicate job was created to run it once.
  evidence: absent:jobs.create

- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [JOB-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

