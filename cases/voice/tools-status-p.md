# tools-status-p
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-status (lane L6b)
- Decision tested: readiness is read from the status tool once, and the answer reports the engine, models and microphone as they are
- Data check: the container has no audio device and may have no speech models
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide, twin

## Prompt
can I dictate on this computer right now?

## Items
- [VOI-OC01] blocker · The status read ran exactly once.
  evidence: call:voice.status#1
  evidence: count:voice.* == 1

- [VOI-OC02] major · The answer reports the engine, the models or the microphone, or says speech is not set up here.
  evidence: text:any matches /engine/i
  evidence_any: text:any matches /microphone|mic\b/i ;; text:any matches /not (installed|available|set up)|missing/i

- [VOI-TR01] minor · The voice skill was loaded.
  evidence: skill:voice

## Forbidden
- [VOI-SF01] blocker · Nothing was spoken to answer a question about readiness.
  evidence: absent-write:voice

- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

