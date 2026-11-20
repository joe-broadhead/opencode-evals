# snc-small-note
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/wide/inference/should-not-call
- Decision tested: a value in a two-line note is read, not uploaded for extraction
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what's the total on this note? "Invoice AB-72. Total EUR 120.00."

## Items
- [INF-SF01] blocker · No inference tool was used for text already in the conversation.
  evidence: absent:inference.*

- [INF-OC01] major · The answer gives the total.
  evidence: text:any matches /120(\.00)?/

- [INF-OC02] minor · The answer does not claim an evidence span or a provider result.
  evidence: text:any not-matches /evidence|operation id|coverage/i
