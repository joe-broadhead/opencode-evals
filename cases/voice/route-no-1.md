# route-no-1
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/should-not-call
- Decision tested: a saved audio file is a synthesis job for Utilities, not a live read-aloud
- Data check: the Utilities plugin is installed
- Seed: plugins=voice,utilities
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
make me an mp3 of this paragraph so I can send it to someone: the release notes are ready.

## Items
- [VOI-SF01] blocker · No voice tool was used for a file.
  evidence: absent:voice.*

- [VOI-RT01] major · The Utilities synthesis tool was used instead.
  evidence: count:utilities.* >= 1

- [VOI-OC01] minor · The answer names a file or a format.
  evidence_any: text:any matches /\.(mp3|wav)\b|saved (it )?(to|as)/i ;; text:any matches /\b(declined|rejected|could not|cannot|can't)\b/i

## Forbidden
- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

