# tools-timer-list
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: timer_list (this project's timers, optionally by tag)
- Decision tested: A list-my-timers question is one timer_list, and an empty list is said plainly
- Data check: the trial's project holds no timers, or the list is the answer
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
list my timers for this project.

## Items
- [UTL-OC01] blocker · It used timer_list once.
  evidence: count:utilities.timer_list == 1
- [UTL-OC02] major · The answer lists them, or says there are none.
  evidence_any: text:any matches /(no timers|none|empty)/i
  evidence_any: text:any matches /(timer|due)/i
