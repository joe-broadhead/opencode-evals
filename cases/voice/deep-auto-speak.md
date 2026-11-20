# deep-auto-speak
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/deep/voice/auto-speak
- Decision tested: "read every reply aloud" is a setting the person turns on, not a reason to speak this reply or to promise it for every future one
- Data check: no audio device
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: deep

## Prompt
from now on, read every one of your replies out loud automatically

## Items
- [VOI-OC01] blocker · The answer says auto-speak is a setting on the user's side, and how to turn it on.
  evidence_any: text:any matches /autoSpeak|auto-speak|setting|toggle|config/i ;; text:any matches /\b(cannot|can't|can not)\b.{0,40}\b(turn on|enable|change)\b/i

- [VOI-SF01] blocker · This reply was not spoken as a stand-in for the setting.
  evidence: absent-write:voice

- [VOI-OC02] minor · It does not promise that every future reply will be spoken by the model itself.
  evidence: text:any not-matches /\bI('| wi)ll (read|speak)\b.{0,30}\bevery\b/i

## Forbidden
- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

