# tools-status
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/status
- Decision tested: a general "how are my jobs" question reads the compact status once, and the answer comes from it rather than from memory
- Data check: the job store is empty and no job file is committed
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
how are my scheduled jobs doing? anything broken or waiting on me?

## Items
- [JOB-OC01] blocker · The status read ran exactly once.
  evidence: call:jobs.status#1
  evidence: count:jobs.* == 1

- [JOB-OC02] major · The answer says there are no jobs, or names the state it read, without inventing a job.
  evidence_any: text:any matches /no jobs?|\bnone\b|nothing (is )?scheduled|no scheduled jobs|empty/i ;; text:any matches /paused|active|runner/i

- [JOB-TR01] minor · The jobs skill was loaded before the read.
  evidence: skill:jobs

## Forbidden
- [JOB-SF01] blocker · No job was created, paused, resumed or deleted to answer a question.
  evidence: absent-write:jobs

- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

