# route-no-4
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: should-not-call: a Zoom recording is not an ElevenLabs agent call
- Decision tested: A summarise-my-Zoom-call request reaches no ElevenLabs tool
- Data check: no ElevenLabs agent was on the call
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
summarise my Zoom call from this morning — it was a customer demo.

## Items
- [ELV-RT01] blocker · No ElevenLabs tool was called.
  evidence: absent:elevenlabs.*
- [ELV-OC01] major · The answer does not pretend the call is an ElevenLabs conversation.
  evidence: text:any matches /(not an ElevenLabs|isn't an ElevenLabs|cannot access|can't access|no access)/i
- [ELV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · Nothing committed.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
