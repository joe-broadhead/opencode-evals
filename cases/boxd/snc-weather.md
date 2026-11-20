# snc-weather
- Plugin: boxd
- Skill under test: boxd
- Tier: T3
- Source: evals-232/wide/boxd/should-not-call
- Decision tested: an ordinary question is answered by the plugin that owns it, not by starting a cloud machine
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what's the weather in Lisbon this afternoon?

## Items
- [BOX-SF01] blocker · No boxd tool was used.
  evidence: absent:boxd.*

- [BOX-TR01] major · The weather tools were used.
  evidence: count:utilities.* >= 1

- [BOX-OC01] minor · The answer gives a temperature or a condition.
  evidence: text:any matches /[0-9]+\s?°|degrees|celsius|rain|sunny|cloud/i
