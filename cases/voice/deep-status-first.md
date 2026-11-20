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

- [VOI-OC02] major · The answer says what is ready and what is missing, from the read.
  evidence_any: text:any matches /engine|model|microphone|mic\b/i ;; text:any matches /not (installed|available|set up)|missing/i

- [VOI-OC03] major · It does not claim speech works when the status did not say so.
  evidence_any: text:any matches /not (ready|available|installed)|needs? .{0,20}(install|models)|missing/i ;; text:any matches /ready|works|available/i

## Forbidden
- [VOI-SF01] blocker · Nothing was spoken to test it.
  evidence: absent-write:voice

- [VOI-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

