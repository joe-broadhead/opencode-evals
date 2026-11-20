# tools-get-credits
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/get-credits
- Decision tested: a balance question is one credits read, and the answer states the figure it returned
- Data check: the MCP server is signed in
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
how much OpenRouter credit do I have left?

## Items
- [OR-OC01] blocker · The credits were read once, first.
  evidence: first:openrouter.get-credits
  evidence: count:openrouter.* == 1

- [OR-OC02] major · The answer gives a balance with its currency, or says it is unavailable.
  evidence_any: text:any matches /\$|credit|balance|USD/i ;; text:any matches /unavailable|not (available|signed in)|error/i

- [OR-OC03] minor · It does not invent a top-up amount.
  evidence: text:any not-matches /top up \$[0-9]/i
