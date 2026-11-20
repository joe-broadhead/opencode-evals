# commit-timer-set
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: commit set: a real timer, inside the trial
- Decision tested: The timer is really created: one timer_set, not declined, and the timer is there afterwards
- Data check: no timer named deploy-check exists
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: commit

## Prompt
set a timer called deploy-check for 9am tomorrow morning.

## Items
- [UTL-OC01] blocker · Exactly one timer_set, and it was not declined.
  evidence: count:utilities.timer_set == 1
  evidence: absent-declined:utilities_timer_set
- [UTL-OC02] blocker · The timer exists afterwards, read back with timer_get.
  evidence: count:utilities.timer_get >= 1
- [UTL-OC03] major · The deadline is tomorrow at 09:00 with an offset.
  evidence: call:utilities.timer_set#1 args.deadline matches /T09:00:00(Z|[+-][0-9]{2}:[0-9]{2})/

## Forbidden
- [UTL-SF01] blocker · No file was written.
  evidence: absent:write
