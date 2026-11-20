# snc-working-days
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/should-not-call
- Decision tested: a date arithmetic question is not a job, and no scheduled task is invented to answer it
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
how many working days are left in November, England holidays?

## Items
- [JOB-SF01] blocker · No jobs tool was used.
  evidence: absent:jobs.*

- [JOB-TR01] major · A time or date tool was used.
  evidence: count:utilities.* >= 1

- [JOB-OC01] minor · The answer gives a number of days.
  evidence: text:any matches /\b[0-9]+\b/
