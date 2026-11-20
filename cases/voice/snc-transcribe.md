# snc-transcribe
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/should-not-call
- Decision tested: transcribing an audio file belongs to Utilities' speech tools, not to voice
- Data check: the Utilities plugin is installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
transcribe recordings/clip.wav for me

## Items
- [VOI-SF01] blocker · No voice tool was used.
  evidence: absent:voice.*

- [VOI-TR01] major · A Utilities speech tool was used instead.
  evidence: count:utilities.* >= 1

- [VOI-OC01] minor · The answer does not claim a live dictation turn happened.
  evidence: text:any not-matches /\b(dictat|microphone)\w*/i
