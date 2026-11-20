# route-no-4
- Plugin: openrouter
- Skill under test: openrouter
- Tier: T3
- Source: evals-232/wide/openrouter/should-not-call
- Decision tested: an everyday question is not routed through a model catalogue or a paid call
- Data check: none
- Seed: plugins=openrouter,utilities
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
what's the weather in Berlin this afternoon?

## Items
- [OR-SF01] blocker · No OpenRouter tool was used.
  evidence: absent:openrouter.*

- [OR-RT01] major · The weather tools were used.
  evidence_any: call:utilities.weather_current#1 ;; call:utilities.weather_summary#1

- [OR-OC01] minor · The answer gives a temperature or a condition.
  evidence: text:any matches /[0-9]+\s?°|degrees|celsius|rain|sunny|cloud/i

## Forbidden
- [OR-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

