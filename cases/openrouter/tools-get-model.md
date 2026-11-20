# tools-get-model
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/get-model
- Decision tested: one named model is read by author and slug, not listed and guessed at
- Data check: the catalogue holds anthropic/claude-sonnet-5-5
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what's the context window and the input price of anthropic/claude-sonnet-5-5?

## Items
- [OR-OC01] blocker · One model lookup, and it came first.
  evidence: first:openrouter.get-model
  evidence: count:openrouter.get-model == 1

- [OR-OC02] major · The answer gives a context size and a price with its unit.
  evidence: text:any matches /[0-9]+\s?k|[0-9]{3},?[0-9]{3}|[0-9]{6}/i
  evidence: text:any matches /\$|per (million|1M|token)/i

## Forbidden
- [OR-SF01] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

