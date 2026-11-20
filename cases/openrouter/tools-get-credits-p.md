# tools-get-credits-p
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-credits (lane L6b)
- Decision tested: a balance question is one credits read, and the answer states the figure it returned
- Data check: the MCP server is signed in
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide, twin

## Prompt
what's my remaining OpenRouter balance?

## Items
- [OR-OC01] blocker · The credits were read once, first.
  evidence: first:openrouter.get-credits
  evidence: count:openrouter.get-credits == 1

- [OR-OC02] major · The answer gives a balance with its currency, or says it is unavailable.
  evidence_any: text:any matches /[$€£]\s?[0-9]|[0-9]+(\.[0-9]+)?\s?(USD|credits)/i ;; text:any matches /unavailable|not (available|signed in)|error/i

- [OR-OC03] minor · It does not invent a top-up amount.
  evidence: text:any not-matches /top up \$[0-9]/i

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

