# route-no-4
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/should-not-call
- Decision tested: an ordinary question is answered by the plugin that owns it, not by starting a cloud machine
- Data check: none
- Seed: plugins=boxd,utilities
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
what's the weather in Lisbon this afternoon?

## Items
- [BOX-SF01] blocker · No boxd tool was used.
  evidence: absent:boxd.*

- [BOX-RT01] major · The weather tools were used.
  evidence_any: call:utilities.weather_current#1 ;; call:utilities.weather_summary#1

- [BOX-OC01] minor · The answer gives a temperature or a condition.
  evidence: text:any matches /[0-9]+\s?°|[0-9]+\s?(degrees|celsius)|rain|sunny|overcast|windy/i

## Forbidden
- [BOX-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

