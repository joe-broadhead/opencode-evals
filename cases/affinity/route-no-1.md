# route-no-1
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: should-not-call: a calendar question belongs to the calendar, not the CRM
- Decision tested: A what-is-on-my-calendar question reaches no Affinity tool
- Data check: the user's calendar holds at least one event tomorrow
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [AFF-RL01] blocker · No Affinity tool was called.
  evidence: absent:affinity.*
- [AFF-OC01] major · The answer answers the calendar question.
  evidence: text:any matches /(calendar|tomorrow|event|meeting)/i
