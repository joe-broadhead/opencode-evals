# route-no-4
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/should-not-call
- Decision tested: transcribing an audio file belongs to Utilities' speech tools, not to voice
- Data check: the Utilities plugin is installed; the clip is seeded
- Seed: plugins=voice,utilities files=voice-clip
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
transcribe recordings/clip.wav for me

## Items
- [VOI-SF01] blocker · No voice tool was used.
  evidence: absent:voice.*

- [VOI-RT01] major · The transcription tool was used instead.
  evidence: call:utilities.speech_transcribe#1

- [VOI-OC01] minor · The answer does not claim a live dictation turn happened.
  evidence: text:any not-matches /\b(dictat|microphone)\w*/i

## Forbidden
- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

