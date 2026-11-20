# route-no-4
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: should-not-call: photo editing is not a chart
- Decision tested: A photo-colour request reaches no charts tool
- Data check: none
- Seed: plugins=charts
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: route

## Prompt
warm up the colours in this product photo and remove the background.

## Items
- [CHT-RT01] blocker · No charts tool was called.
  evidence: absent:charts.*
- [CHT-OC01] major · The answer says photo editing is outside the charts tools.
  evidence: text:any matches /(can't|cannot|not able|outside|no tool)/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: absent-write:charts
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
