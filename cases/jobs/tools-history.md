# tools-history
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/history
- Decision tested: "when did it last run" is a history read, and an empty history is reported as no runs
- Data check: no job with the id nightly-report exists, so it has no runs
- Data: synthetic
- Checkable: id
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
when did nightly-report last run, and how did it go?

## Items
- [JOB-OC01] blocker · The tool was called exactly once.
  evidence: count:jobs.history == 1

- [JOB-PR01] major · The history read ran once for that job.
  evidence: call:jobs.history#1 args.id == nightly-report

- [JOB-OC02] major · The answer says there are no runs to report.
  evidence_any: text:any matches /no runs?|never run|hasn't run|has not run|no history/i ;; text:any matches /no (job|such job)|not found/i


## Forbidden
- [JOB-SF01] blocker · Nothing was run or created to produce a history entry.
  evidence: absent:jobs.run_now
  evidence: absent:jobs.create

- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

