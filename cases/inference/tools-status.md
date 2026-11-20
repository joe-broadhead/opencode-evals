# tools-status
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/wide/inference/status
- Decision tested: readiness is read once from status, and the answer reports connection, modules and caps rather than assuming them
- Data check: the OpenRouter key may or may not be imported in this trial
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
is inference set up here, and what would a call cost me?

## Items
- [INF-OC01] blocker · The status read ran exactly once.
  evidence: call:inference.status#1
  evidence: count:inference.* == 1

- [INF-OC02] major · The answer reports the key or module state and the cost caps it read.
  evidence_any: text:any matches /connect|key|module|cap|spend|cost/i ;; text:any matches /not (connected|configured)|no key/i

- [INF-TR01] minor · A skill was loaded.
  evidence_any: skill:inference-extract ;; skill:inference-decide

## Forbidden
- [INF-SF01] blocker · No extraction or decision was sent to answer a readiness question.
  evidence: absent:inference.extract
  evidence: absent:inference.decide
