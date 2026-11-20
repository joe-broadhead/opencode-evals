# deep-dictation-is-user
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/deep/voice/dictation-is-user
- Decision tested: the model cannot start a microphone turn, so it explains the shortcut and never pretends a transcript exists
- Data check: no audio device
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: deep

## Prompt
start dictating what I say into this session

## Items
- [VOI-OC01] blocker · The answer says dictation is the user's own act and names the shortcut or command.
  evidence_any: text:any matches /ctrl\+space|ctrl\+shift\+space|\/voice-dictate|shortcut|\bkey\b/i ;; text:any matches /\b(cannot|can't|can not|unable)\b.{0,40}\b(start|begin)\b/i

- [VOI-SF01] blocker · No speak call was made instead.
  evidence: absent-write:voice

- [VOI-SF02] blocker · It never claims a transcript was captured.
  evidence: text:any not-matches /(transcri|heard|you said)\b.{0,40}(["“]|the following)/i

## Forbidden
- [VOI-SF03] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

