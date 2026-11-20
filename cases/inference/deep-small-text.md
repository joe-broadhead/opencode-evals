# deep-small-text
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/deep/inference/small-text
- Decision tested: a short note the model can read is answered directly, with no upload and no paid call
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: deep

## Prompt
extract the total and the due date from this: "Invoice AB-72. Total EUR 120.00. Net 30 from 1 November 2026."

## Items
- [INF-OC01] blocker · No inference tool was used.
  evidence: absent:inference.*

- [INF-OC02] major · The answer gives the total and a due date.
  evidence: text:any matches /120(\.00)?/
  evidence: text:any matches /(1 December 2026|2026-12-01|December 1,? 2026|Dec(ember)? 1)/i

- [INF-OC03] minor · It says it read the text directly rather than uploading it.
  evidence_any: text:any matches /read (it|the text) (directly|here)|no need to (send|upload)/i ;; text:any matches /free|locally/i
