# route-no-3
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: should-not-call: a non-hiring meeting recap belongs to Granola
- Decision tested: A what-did-we-decide-in-the-planning-meeting question reaches no ElevenLabs tool
- Data check: the user has a planning meeting note from yesterday
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
what did we decide in yesterday's planning meeting?

## Items
- [ELV-RT01] blocker · No ElevenLabs tool was called.
  evidence: absent:elevenlabs.*
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · Nothing committed.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
