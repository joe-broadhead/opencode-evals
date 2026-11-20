# route-no-3
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: should-not-call: a non-hiring meeting recap belongs to Granola
- Decision tested: A what-did-we-decide-in-the-planning-meeting question reaches no ElevenLabs tool
- Data check: the user has a planning meeting note from yesterday
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what did we decide in yesterday's planning meeting?

## Items
- [ELV-RL01] blocker · No ElevenLabs tool was called.
  evidence: absent:elevenlabs.*
- [ELV-OC01] major · The answer looks for the meeting notes.
  evidence: text:any matches /(meeting|notes|Granola|decided)/i
