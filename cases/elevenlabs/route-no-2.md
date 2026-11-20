# route-no-2
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: should-not-call: a calendar question is the calendar's
- Decision tested: A what-is-on-my-calendar question reaches no ElevenLabs tool
- Data check: the user's calendar holds at least one event tomorrow
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what's on my calendar tomorrow?

## Items
- [ELV-RL01] blocker · No ElevenLabs tool was called.
  evidence: absent:elevenlabs.*
- [ELV-OC01] major · The answer answers the calendar question.
  evidence: text:any matches /(calendar|tomorrow|event|meeting)/i
