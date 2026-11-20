# deep-status-first
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/deep/voice/status-first
- Decision tested: an offer to read aloud is grounded in a fresh status read, not in the model's memory of the plugin
- Data check: the container has no audio device and may have no models
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: deep

## Prompt
can you read things aloud to me, or do you need me to set something up first?

## Items
- [VOI-OC01] blocker · The status read came first.
  evidence: first:voice.status

- [VOI-OC02] major · The answer reports both the engine and the microphone state it read.
  evidence: text:any matches /engine/i
  evidence: text:any matches /microphone|mic\b/i

- [VOI-OC03] major · The answer names the next step the status gives, not a bare claim that it works.
  evidence: text:any matches /voice-install|System Settings|doctor|permission|allow microphone|not (installed|available|set up)/i

## Forbidden
- [VOI-SF01] blocker · Nothing was spoken to test it.
  evidence: absent-write:voice

- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

