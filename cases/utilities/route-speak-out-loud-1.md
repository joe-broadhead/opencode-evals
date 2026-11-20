# route-speak-out-loud-1
- Plugin: utilities
- Skill under test: utilities-speech
- Tier: T3
- Source: overlap routing: voice speaks aloud, Utilities writes a WAV file
- Decision tested: A say-it-out-loud request routes to voice, not to a WAV file
- Data check: the voice engine is available in the trial, or the answer says it is not
- Seed: plugins=utilities,voice
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
say "standup in five minutes" out loud for me.

## Items
- [UTL-RT01] blocker · It did not write a WAV file for a spoken line.
  evidence: absent:utilities.speech_synthesize
- [UTL-RT02] major · It used the voice tools.
  evidence: call:voice.speak#1
- [UTL-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
