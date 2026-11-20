# route-no-4
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: should-not-call: a Zoom recording is not an ElevenLabs agent call
- Decision tested: A summarise-my-Zoom-call request reaches no ElevenLabs tool
- Data check: none: no ElevenLabs agent was on the call
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
summarise my Zoom call from this morning — it was a customer demo.

## Items
- [ELV-RL01] blocker · No ElevenLabs tool was called.
  evidence: absent:elevenlabs.*
- [ELV-OC01] major · The answer does not pretend the call is an ElevenLabs conversation.
  evidence: text:any matches /(Zoom|not an ElevenLabs|cannot|can't|no access)/i
