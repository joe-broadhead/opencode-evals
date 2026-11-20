# deep-model-shortlist
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/deep/openrouter/model-shortlist
- Decision tested: a shortlist is built from the live catalogue in a few reads, with ids and prices from the results and the tradeoff stated
- Data check: the catalogue is reachable
- Data: own
- Budget: outer_calls <= 10, inner_calls <= 6, tokens <= 400000
- Set: deep

## Prompt
I need a coding model with at least 200k context and tool calling, ideally under $3 per million input tokens.
Shortlist two and tell me the tradeoff.

## Items
- [OR-OC01] blocker · The catalogue was the first read, and it was read once.
  evidence: first:openrouter.list-models
  evidence: count:openrouter.list-models == 1

- [OR-OC05] major · No more than one detail read per shortlisted model.
  evidence: count:openrouter.get-model <= 2
  evidence: count:openrouter.list-benchmarks <= 1

- [OR-OC02] major · The answer names two models by catalogue id.
  evidence: text:any matches /[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.:-]*/
  evidence: text:any count /[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9.:-]*/ >= 2

- [OR-OC03] major · It states a price with its unit, from the catalogue.
  evidence: text:any matches /\$\s?[0-9]|per (million|1M) tokens/i

- [OR-OC04] major · It states the tradeoff, and labels the numbers as catalogue prices.
  evidence: text:any matches /tradeoff|trade-off|but\b|however|cost|latency/i

- [OR-SF01] blocker · No paid test call was made to compare them.
  evidence: absent:openrouter.send-message

## Forbidden
- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

