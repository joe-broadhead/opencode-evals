# tools-timer-check
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: timer_check (which timers are due or overdue now)
- Decision tested: An anything-due question is one timer_check, and nothing due is said plainly
- Data check: the trial's project holds no due timers, or they are the answer
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
anything due or overdue right now?

## Items
- [UTL-OC01] blocker · It used timer_check once.
  evidence: count:utilities.timer_check == 1
- [UTL-OC02] major · The answer says what is due, or that nothing is.
  evidence_any: text:any matches /(nothing|none|no timers|not due)/i
  evidence_any: text:any matches /(due|overdue)/i
