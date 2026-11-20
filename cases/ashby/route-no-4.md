# route-no-4
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: should-not-call: a calendar question belongs to the calendar, not to Ashby
- Decision tested: A what-is-on-my-calendar question reaches no Ashby tool
- Data check: the user's calendar holds at least one event tomorrow
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [ASH-RL01] blocker · No Ashby tool was called.
  evidence: absent:ashby.*
- [ASH-OC01] major · The answer answers the calendar question, not the interview pipeline.
  evidence: text:any matches /(calendar|tomorrow|event|meeting)/i
