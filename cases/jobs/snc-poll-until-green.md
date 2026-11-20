# snc-poll-until-green
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/should-not-call
- Decision tested: a tight poll-until-green loop is not a scheduled job, and the answer does not create one to fake a loop
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
check the deploy every 30 seconds until it's green, then tell me

## Items
- [JOB-SF01] blocker · No job was created for a sub-minute loop.
  evidence: absent:jobs.create
  evidence: absent:jobs.*

- [JOB-OC01] major · The answer says it cannot watch a deploy that way, or offers a bounded check instead of a loop.
  evidence_any: text:any matches /\b(cannot|can't|can not|unable)\b.{0,50}\b(watch|poll|loop|every 30)\b/i ;; text:any matches /\b(check|once|now)\b.{0,40}\b(instead|rather)\b/i
