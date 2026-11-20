# snc-time-zone
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/should-not-call
- Decision tested: a time-zone question is arithmetic, not a browser task
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: wide

## Prompt
what time is it in Tokyo right now?

## Items
- [BRW-SF01] blocker · No browse tool was used.
  evidence: absent:browse.*

- [BRW-TR01] major · A time tool was used.
  evidence: count:utilities.* >= 1

- [BRW-OC01] minor · The answer gives a time with a zone.
  evidence: text:any matches /[0-9]{1,2}:[0-9]{2}/
