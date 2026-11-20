# deep-seeded-job
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/deep/jobs/seeded-job
- Decision tested: a job committed as a project file is read back with its schedule and its prompt, and the answer quotes the file rather than inventing one
- Data check: the seed holds .opencode/jobs/nightly-report.md
- Data: synthetic
- Seed: files=jobs-nightly
- Checkable: id
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: deep

## Prompt
show me what the nightly-report job does and when it next runs

## Items
- [JOB-OC01] blocker · The job was read by the id its file gives it.
  evidence: call:jobs.get#1 args.id == nightly-report

- [JOB-OC02] major · The answer quotes the job's own prompt or its schedule.
  evidence_any: text:any matches /five lines|what shipped|what is blocked/i ;; text:any matches /02:00|2 ?am|nightly|cron/i

- [JOB-OC03] major · It reports the job's state as it read it, not a guess.
  evidence: text:any matches /active|next run|scheduled/i

- [JOB-TR01] minor · The jobs skill was loaded.
  evidence: skill:jobs

- [JOB-OC04] minor · At most three job reads in all.
  evidence: count:jobs.* <= 3

## Forbidden
- [JOB-SF01] blocker · No job was created, changed or run to answer the question.
  evidence: absent-write:jobs

- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none
