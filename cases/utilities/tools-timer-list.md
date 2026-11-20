# tools-timer-list
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: timer_list (this project's timers, optionally by tag)
- Decision tested: A list-my-timers question is one timer_list, and an empty list is said plainly
- Data check: the trial's project holds no timers, or the list is the answer
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
list my timers for this project.

## Items
- [UTL-TR01] blocker · It used timer_list once.
  evidence: call:utilities.timer_list#1
- [UTL-OC01] major · The answer lists them, or says there are none.
  evidence_any: text:any matches /(no timers|none|empty)/i
  evidence_any: text:any matches /(timer|due)/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
