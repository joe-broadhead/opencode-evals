# tools-list
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/list
- Decision tested: "what jobs do I have" is one list read, with no history call and no invented names
- Data check: the job store is empty and no job file is committed
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what jobs do I have scheduled at the moment?

## Items
- [JOB-OC01] blocker · The list read ran exactly once.
  evidence: call:jobs.list#1
  evidence: count:jobs.* == 1

- [JOB-OC02] major · The answer reports an empty list, not a made-up job.
  evidence_any: text:any matches /no jobs?|none|nothing (is )?scheduled|empty/i ;; text:any matches /\b0 jobs?\b/i


## Forbidden
- [JOB-SF01] blocker · No write of any kind.
  evidence: absent-write:jobs

- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

