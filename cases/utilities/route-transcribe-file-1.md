# route-transcribe-file-1
- Plugin: utilities
- Skill under test: utilities-speech
- Tier: T3
- Source: overlap routing: transcribing a file is Utilities', not voice's
- Decision tested: A transcribe-this-WAV request routes to Utilities' transcriber, not to the voice tools
- Data check: clip.wav is a 16-bit PCM WAV in the trial's working directory
- Seed: plugins=utilities files=utilities-clip
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: route

## Prompt
transcribe clip.wav — I want the words in it.

## Items
- [UTL-RT01] blocker · It used the Utilities transcriber.
  evidence: count:utilities.speech_transcribe == 1
- [UTL-RT02] blocker · It did not use the voice tools.
  evidence: absent:voice.*
- [UTL-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
