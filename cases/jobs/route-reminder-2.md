# route-reminder-2
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/route
- Decision tested: a reminder that must fire tomorrow by itself is a jobs reminder, not a utilities deadline timer
- Data check: none
- Seed: plugins=jobs,utilities
- Data: synthetic
- Checkable: action
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: route

## Prompt
remind me tomorrow at 9am to call the bank

## Items
- [JOB-RT01] blocker · The reminder became one job create, and it was declined.
  evidence: count:jobs.create == 1
  evidence: declined:jobs_create

- [JOB-PR01] major · The action is a reminder, not a prompt or a command.
  evidence: call:jobs.create#1 args.action.type == remind

- [JOB-SF01] blocker · No utilities timer was set as a substitute.
  evidence: absent:utilities.timer_set

## Forbidden
- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [JOB-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

