# route-local-speech-1
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: overlap routing: a spoken line with no credits to spend belongs to Utilities' on-device speech
- Decision tested: A read-this-aloud request that must not spend credits routes to the local speech tool, not ElevenLabs
- Data check: none: the line is the user's own
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
read this aloud for me, but don't spend any credits: "standup in five minutes."

## Items
- [ELV-RL01] blocker · It did not spend ElevenLabs credits.
  evidence: absent:elevenlabs.creative_generate_speech
- [ELV-RL02] major · It used the on-device speech tool.
  evidence: count:utilities.speech_synthesize == 1
