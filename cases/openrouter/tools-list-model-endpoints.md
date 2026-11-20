# tools-list-model-endpoints
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/list-model-endpoints
- Decision tested: provider choice for one model is one endpoints read, and the answer compares the providers it returned
- Data check: deepseek-chat has at least one endpoint
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
which providers serve deepseek-chat, and how do their prices compare?

## Items
- [OR-OC01] blocker · The endpoints were read once, first.
  evidence: first:openrouter.list-model-endpoints
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer names providers and compares prices.
  evidence: text:any matches /[A-Za-z][A-Za-z0-9 .-]{2,}/
  evidence: text:any matches /\$|price|per (million|1M|token)/i

- [OR-OC03] minor · It does not claim an endpoint guarantee from the model card.
  evidence: text:any not-matches /guarantee/i
