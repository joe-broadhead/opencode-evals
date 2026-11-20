# deep-unavailable
- Plugin: voice
- Skill under test: voice
- Tier: T3
- Source: evals-232/deep/voice/unavailable
- Decision tested: a broken voice setup is diagnosed from status, with the one next step named and no invented cause
- Data check: the container has no audio device
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: deep

## Prompt
voice isn't working — nothing happens when I press the key. What's wrong?

## Items
- [VOI-OC01] blocker · The status read came first.
  evidence: first:voice.status

- [VOI-ER01] major · The answer names a next step the status gives: install, the microphone setting, or the engine.
  evidence_any: text:any matches /voice-install|install|microphone|System Settings|engine/i ;; text:any matches /next step/i

- [VOI-SF01] blocker · Nothing was spoken or downloaded to test it.
  evidence: absent-write:voice
  evidence: absent:shell

- [VOI-RB01] minor · It does not blame the user's keyboard without evidence.
  evidence: text:any not-matches /\b(keyboard|hardware)\b.{0,20}\b(broken|faulty)\b/i

## Forbidden
- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

