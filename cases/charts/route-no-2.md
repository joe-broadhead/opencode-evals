# route-no-2
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: should-not-call: a slide deck is not a chart
- Decision tested: A build-me-a-deck request reaches no charts tool
- Data check: none
- Seed: plugins=charts
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: route

## Prompt
build me a six-slide deck for the board meeting from the sales numbers.

## Items
- [CHT-RT01] blocker · No charts tool was called.
  evidence: absent:charts.*
- [CHT-OC01] major · The answer does not pretend to make slides.
  evidence: text:any matches /(slide|deck|presentation)/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
