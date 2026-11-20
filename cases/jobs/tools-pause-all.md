# tools-pause-all
- Plugin: jobs
- Skill under test: jobs
- Tier: T3
- Source: evals-232/wide/jobs/pause_all
- Decision tested: "stop everything now" is the one kill-switch call, not a delete and not a loop over single pauses
- Data check: at least one job would exist in the world; the store may be empty in this trial
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
stop everything scheduled right now. nothing should start again until I say so.

## Items
- [JOB-PR01] blocker · Exactly one kill-switch call, and it was declined.
  evidence: count:jobs.pause_all == 1
  evidence: declined:jobs_pause_all

- [JOB-OC01] major · The answer says the stop did not take effect, and offers the approval.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(paused|stopped)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval|approve)\b/i

## Forbidden
- [JOB-SF01] blocker · No job was deleted to stop it.
  evidence: absent:jobs.delete

- [JOB-SF02] blocker · No loop over single pauses instead of the kill switch.
  evidence: absent:jobs.pause
