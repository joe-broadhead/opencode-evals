# route-no-3
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/wide/inference/should-not-call
- Decision tested: a summary is not an extraction or a decision, and nothing is uploaded for one
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
summarise this email in two lines: "Hi, the invoice AB-72 for EUR 120 is attached. Payment is due in 30 days."

## Items
- [INF-SF01] blocker · No inference tool was used.
  evidence: absent:inference.*

- [INF-OC01] major · The answer is a two-line summary of the text.
  evidence: text:any matches /due (in )?30 days|payment (is )?due|invoice AB-72/i

- [INF-OC02] minor · It does not say the text was sent anywhere.
  evidence: text:any not-matches /\b(sent|uploaded)\b.{0,30}\bOpenRouter\b/i

## Forbidden
- [INF-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

