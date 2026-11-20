# route-no-3
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/should-not-call
- Decision tested: a question about past coding work belongs to History, and the jobs plugin is not a search index for it
- Data check: the history world is empty; the routing is what is measured
- Seed: plugins=jobs,history
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
what did I work on yesterday? just the sessions, newest first.

## Items
- [JOB-SF01] blocker · No jobs tool was used.
  evidence: absent:jobs.*

- [JOB-RT01] major · The history tools were used instead.
  evidence: count:history.* >= 1

- [JOB-OC01] minor · The answer does not describe a scheduled job as if it were work.
  evidence: text:any not-matches /\b(scheduled|job|jobs)\b.{0,20}\b(yesterday|session)\b/i

## Forbidden
- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

