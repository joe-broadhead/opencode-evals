# route-no-4
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/should-not-call
- Decision tested: a date arithmetic question is not a job, and no scheduled task is invented to answer it
- Data check: none
- Seed: plugins=jobs,utilities utc-hours=9-17
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
how many working days are left in November, England holidays?

## Items
- [JOB-SF01] blocker · No jobs tool was used.
  evidence: absent:jobs.*

- [JOB-RT01] major · The working-days tool was used.
  evidence: call:utilities.time_business_days#1

- [JOB-OC01] minor · The answer gives a number of days.
  evidence: text:any matches /\b[0-9]{1,2}\b.{0,20}\b(working )?days?\b|\b(working )?days?\b.{0,20}\b[0-9]{1,2}\b/i

## Forbidden
- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

