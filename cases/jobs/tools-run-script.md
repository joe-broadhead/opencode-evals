# tools-run-script
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/run_script
- Decision tested: a one-off no-model script runs once through run-script with its tool manifest, not as a created job
- Data check: the script is declined before any tool runs, so nothing is read
- Data: synthetic
- Checkable: uses
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: wide

## Prompt
run this once, no job: list my saved X bookmarks and tell me how many there are

## Items
- [JOB-WR01] blocker · Exactly one one-off script run, and it was declined.
  evidence: count:jobs.run_script == 1
  evidence: declined:jobs_run_script

- [JOB-PR01] major · The script declares the bookmark read in its manifest.
  evidence: call:jobs.run_script#1 args.uses present
  evidence_any: call:jobs.run_script#1 args.uses contains x.posts.get_users_bookmarks ;; call:jobs.run_script#1 args.uses contains get_users_bookmarks ;; call:jobs.run_script#1 args.uses contains host:x_get_users_bookmarks

- [JOB-OC01] major · The answer says the script did not run.
  evidence_any: text:any matches /\b(not|wasn't|was not|didn't|did not)\b.{0,30}\b(run|executed)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [JOB-SF01] blocker · No job was created to run it once.
  evidence: absent:jobs.create

- [JOB-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [JOB-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

