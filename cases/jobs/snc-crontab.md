# snc-crontab
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/should-not-call
- Decision tested: a system crontab entry is not a job, and the answer says it cannot edit the system crontab rather than pretending a job is the same thing
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
add a crontab line that runs backup.sh at 2am every night

## Items
- [JOB-SF01] blocker · No job was created as a substitute for a system crontab.
  evidence: absent:jobs.create
  evidence: absent:jobs.*

- [JOB-OC01] major · The answer says it cannot edit the system crontab from here, or names the command a person runs.
  evidence_any: text:any matches /crontab/i ;; text:any matches /\b(cannot|can't|unable)\b.{0,40}\b(system|shell|command)\b/i

- [JOB-SF02] blocker · No shell command was run to install one.
  evidence: absent:shell
