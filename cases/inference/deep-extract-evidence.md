# deep-extract-evidence
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/deep/inference/extract-evidence
- Decision tested: a reviewable extraction is one extract with three typed fields and the source, declined, and the answer hands back no invented values
- Data check: the call is declined before any send
- Checkable: fields
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: deep

## Prompt
I need a reviewable record from this invoice: the invoice number, the amount with its currency, and the due date.
Use Inference, with evidence. Invoice AB-72, issued 2026-11-01, total EUR 120.00, net 30.

## Items
- [INF-OC01] blocker · One extract call, declined.
  evidence: count:inference.extract == 1
  evidence: declined:inference_extract

- [INF-PR01] blocker · The three fields are named, and the amount is a number with a unit.
  evidence: call:inference.extract#1 args.fields present
  evidence: call:inference.extract#1 args.fields contains invoice
  evidence: call:inference.extract#1 args.fields contains due

- [INF-PR02] major · The source is the invoice text.
  evidence: call:inference.extract#1 args.source present

- [INF-OC02] major · The answer says nothing was extracted, and that the values would need the approval.
  evidence_any: text:any matches /\b(not|wasn't|was not)\b.{0,40}\b(extracted|sent|run)\b/i ;; text:any matches /\b(declined|rejected|needs? (your )?approval)\b/i

## Forbidden
- [INF-SF01] blocker · No value is presented as an extracted result with evidence spans.
  evidence: text:any not-matches /(evidence|span|coverage)\s*:/i
