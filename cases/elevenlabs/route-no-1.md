# route-no-1
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: should-not-call: account help has no tool
- Decision tested: A password-reset question reaches no ElevenLabs tool
- Data check: none
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
how do I reset my ElevenLabs password?

## Items
- [ELV-RL01] blocker · No ElevenLabs tool was called.
  evidence: absent:elevenlabs.*
- [ELV-OC01] major · The answer points at ElevenLabs' own account settings.
  evidence: text:any matches /(account|settings|password|ElevenLabs)/i
