# route-no-3
- Plugin: browse
- Skill under test: browse
- Tier: T3
- Source: evals-232/wide/browse/should-not-call
- Decision tested: a time-zone question is arithmetic, not a browser task
- Data check: none
- Seed: plugins=browse,utilities
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000
- Set: route

## Prompt
what time is it in Tokyo right now?

## Items
- [BRW-SF01] blocker · No browse tool was used.
  evidence: absent:browse.*

- [BRW-RT01] major · A time tool was used.
  evidence_any: call:utilities.time_now#1 ;; call:utilities.time_zone_info#1 ;; call:utilities.time_convert#1

- [BRW-OC01] minor · The answer gives a time with a zone.
  evidence: text:any matches /[0-9]{1,2}:[0-9]{2}/

## Forbidden
- [BRW-SF02] blocker · No call named a tool that does not exist.
  evidence: unknown-tool:none

