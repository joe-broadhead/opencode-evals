# route-local-transcribe-1
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: overlap routing: transcribing a local WAV without uploading it is Utilities'
- Decision tested: A transcribe-on-this-machine request routes to the local transcriber, not ElevenLabs
- Data check: clip.wav is a 16-bit PCM WAV in the trial's working directory
- Seed: plugins=elevenlabs,utilities
- Data: own
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: route

## Prompt
transcribe clip.wav on this machine — don't upload it anywhere.

## Items
- [ELV-RT01] blocker · It did not send the audio to ElevenLabs.
  evidence: absent:elevenlabs.creative_transcribe_audio
- [ELV-RT02] major · It used the local transcriber.
  evidence: count:utilities.speech_transcribe == 1
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
