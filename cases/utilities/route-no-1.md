# route-no-1
- Plugin: utilities
- Skill under test: utilities
- Tier: T3
- Source: should-not-call: calendar events belong to the calendar, not to Utilities
- Decision tested: A what-is-on-my-calendar question reaches no utilities tool
- Data check: the user's calendar holds at least one event tomorrow
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [UTL-RL01] blocker · No utilities tool was called.
  evidence: absent:utilities.*
- [UTL-OC01] major · The answer answers the calendar question.
  evidence: text:any matches /(calendar|tomorrow|event|meeting)/i
