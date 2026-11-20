# route-no-1
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: should-not-call: a general calendar question is the calendar's, not Metaview's
- Decision tested: A what-is-on-my-calendar question reaches no Metaview tool
- Data check: the user's calendar holds at least one event tomorrow
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [MV-RL01] blocker · No Metaview tool was called.
  evidence: absent:metaview.*
- [MV-OC01] major · The answer answers the calendar question.
  evidence: text:any matches /(calendar|tomorrow|event|meeting)/i
