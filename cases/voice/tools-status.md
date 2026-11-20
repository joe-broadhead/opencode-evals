# tools-status
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/wide/voice/status
- Decision tested: readiness is read from the status tool once, and the answer reports the engine, models and microphone as they are
- Data check: the container has no audio device and may have no speech models
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
is dictation ready to use on this machine?

## Items
- [VOI-OC01] blocker · The status read ran exactly once.
  evidence: call:voice.status#1
  evidence: count:voice.* == 1

- [VOI-OC02] major · The answer reports the engine, the models or the microphone, or says speech is not set up here.
  evidence_any: text:any matches /engine|model|microphone|mic\b/i ;; text:any matches /not (installed|available|set up)|missing/i

- [VOI-TR01] minor · The voice skill was loaded.
  evidence: skill:voice

## Forbidden
- [VOI-SF01] blocker · Nothing was spoken to answer a question about readiness.
  evidence: absent:voice.speak
