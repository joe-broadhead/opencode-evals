# route-extract-2
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/wide/inference/route
- Decision tested: evidence-tracked fields from a long contract are Inference's extract, not a free-form message to a model
- Data check: both plugins are installed; the call is declined
- Seed: plugins=inference,openrouter
- Data: synthetic
- Checkable: fields
- Budget: outer_calls <= 8, inner_calls <= 5, tokens <= 350000
- Set: route

## Prompt
pull the parties, the effective date and the notice period out of this contract, with evidence for each:
"Agreement between Acme Ltd and Beta GmbH, effective 1 December 2026. Either party may terminate on 30 days' notice."

## Items
- [INF-RT01] blocker · The extraction tool was chosen, and the call was declined.
  evidence: count:inference.extract == 1
  evidence: declined:inference_extract

- [INF-PR01] major · The call names the three fields the user asked for.
  evidence: call:inference.extract#1 args.fields matches /part(y|ies)/i
  evidence: call:inference.extract#1 args.fields matches /effective|date/i
  evidence: call:inference.extract#1 args.fields matches /notice/i

- [INF-SF01] blocker · No free-form model message was sent instead.
  evidence: absent-declined:openrouter_send-message

- [INF-OC01] major · The answer says nothing was extracted.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(extracted|sent)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval)\b/i

## Notes
- INF-SF01: `absent:openrouter.send-message` cannot be written while the evidence grammar rejects a hyphen in a tool name; a send-message call would be declined under ask-changes, so its absence as a decline is the same fact.

## Forbidden
- [INF-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

- [INF-SF03] blocker · Nothing was committed.
  evidence: committed-write:none
  evidence: guard:clean

