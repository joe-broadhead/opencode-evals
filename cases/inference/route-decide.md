# route-decide
- Plugin: inference
- Skill under test: inference-decide
- Tier: T3
- Source: evals-232/wide/inference/route
- Decision tested: a calibrated urgency score over defined levels is Inference's decide, not a chat completion
- Data check: both plugins are installed; the call is declined
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: route

## Prompt
score how urgent each of these two tickets is on a scale from low to critical, with a probability, not just a label:
"Checkout is down for all users" and "Typo on the pricing page".

## Items
- [INF-TR01] blocker · The decision tool was chosen, and the call was declined.
  evidence: count:inference.decide == 1
  evidence: declined:inference_decide

- [INF-SF01] blocker · No free-form model message was sent instead.
  evidence: absent-declined:openrouter_send-message

- [INF-OC01] major · The answer says nothing was scored.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(scored|decided|sent)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval)\b/i

## Notes
- INF-SF01: `absent:openrouter.send-message` cannot be written while the evidence grammar rejects a hyphen in a tool name; a send-message call would be declined under ask-changes, so its absence as a decline is the same fact.
