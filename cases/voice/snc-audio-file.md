# snc-audio-file
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/should-not-call
- Decision tested: a saved audio file is a synthesis job for Utilities, not a live read-aloud
- Data check: the Utilities plugin is installed
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
make me an mp3 of this paragraph so I can send it to someone: the release notes are ready.

## Items
- [VOI-SF01] blocker · No voice tool was used for a file.
  evidence: absent:voice.*

- [VOI-TR01] major · The Utilities synthesis tool was used instead.
  evidence: count:utilities.* >= 1

- [VOI-OC01] minor · The answer names a file or a format.
  evidence: text:any matches /\.(mp3|wav)\b|audio file/i
