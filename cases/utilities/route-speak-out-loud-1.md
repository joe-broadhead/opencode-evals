# route-speak-out-loud-1
- Plugin: utilities
- Skill under test: utilities-speech
- Tier: T3
- Source: overlap routing: voice speaks aloud, Utilities writes a WAV file
- Decision tested: A say-it-out-loud request routes to voice, not to a WAV file
- Data check: the voice engine is available in the trial, or the answer says it is not
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
say "standup in five minutes" out loud for me.

## Items
- [UTL-RL01] blocker · It did not write a WAV file for a spoken line.
  evidence: absent:utilities.speech_synthesize
- [UTL-RL02] major · It used the voice tools.
  evidence: count:voice.* >= 1
