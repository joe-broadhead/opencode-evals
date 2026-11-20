# route-live-speak-2
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/route
- Decision tested: "read this to me now" is the live read-aloud tool, not a file written by Utilities
- Data check: both plugins are installed
- Seed: plugins=voice,utilities
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
read this back to me out loud: the backup finished at 3am and everything is green.

## Items
- [VOI-RT01] blocker · The live speak tool was chosen, and the call was declined.
  evidence: count:voice.speak == 1
  evidence: declined:voice_speak

- [VOI-SF01] blocker · No audio file was synthesized instead.
  evidence: absent:utilities.speech_synthesize

- [VOI-OC01] major · The answer says nothing was spoken.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,30}\b(spoken|played|read)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval)\b/i

## Forbidden
- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [VOI-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

