# route-no-3
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/should-not-call
- Decision tested: a reminder is a scheduled job, not a spoken message now
- Data check: the Jobs plugin is installed
- Seed: plugins=voice,jobs utc-hours=9-17
- Data: synthetic
- Checkable: action, schedule
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
remind me at 9 tomorrow morning to call the bank

## Items
- [VOI-SF01] blocker · No voice tool was used.
  evidence: absent:voice.*

- [VOI-RT01] blocker · The reminder became one job create, and it was declined.
  evidence: count:jobs.create == 1
  evidence: declined:jobs_create

- [VOI-PR01] major · The action is a reminder, not a prompt.
  evidence: call:jobs.create#1 args.action.type == remind

- [VOI-PR02] major · The reminder is for 09:00.
  evidence_any: call:jobs.create#1 args.schedule.at matches /T09:00/ ;; call:jobs.create#1 args.schedule.cron matches /^0 9 \* \* \*$/

- [VOI-OC02] major · The answer says the reminder was not set.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(created|scheduled|set)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval)\b/i

- [VOI-OC01] minor · The answer does not say it will speak the reminder aloud.
  evidence: text:any not-matches /\b(speak|read aloud)\b.{0,30}\bremind/i

## Forbidden
- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [VOI-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean
