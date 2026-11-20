# tools-timer-get
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: timer_get (one project timer by name)
- Decision tested: A timer-status question is one timer_get, and a missing timer is reported as missing
- Data check: no timer named deploy-check exists in the trial, so the honest answer is that it is not there
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what's the status of my deploy-check timer?

## Items
- [UTL-OC01] blocker · It used timer_get once.
  evidence: count:utilities.timer_get == 1
- [UTL-PR01] major · It asked for the timer the user named.
  evidence: call:utilities.timer_get#1 args.name == deploy-check
- [UTL-OC03] major · The answer says whether it exists, without inventing a deadline.
  evidence_any: text:any matches /(not found|no timer|doesn't exist|does not exist|no such)/i
  evidence_any: text:any matches /(due|remaining|status)/i
