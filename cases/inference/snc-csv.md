# snc-csv
- Plugin: inference
- Skill under test: inference-extract
- Tier: T3
- Source: evals-232/wide/inference/should-not-call
- Decision tested: arithmetic over structured data is code or a read, not a model extraction
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
add up column B in this CSV and tell me the total: a,10 / b,20 / c,5

## Items
- [INF-SF01] blocker · No inference tool was used.
  evidence: absent:inference.*

- [INF-OC01] major · The answer gives 35.
  evidence: text:any matches /\b35\b/

- [INF-OC02] minor · It does not describe an extraction route.
  evidence: text:any not-matches /clairic|extraction route|provider/i
