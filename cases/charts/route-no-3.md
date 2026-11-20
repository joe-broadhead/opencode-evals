# route-no-3
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: should-not-call: a 3-D scientific surface belongs to code, not charts
- Decision tested: A 3-D surface request reaches no charts tool, and the answer points at code
- Data check: none
- Seed: plugins=charts
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: route

## Prompt
plot z = sin(x) * cos(y) as a 3-D surface, 60 by 60, with a colour map.

## Items
- [CHT-RT01] blocker · No charts tool was called.
  evidence: absent:charts.*
- [CHT-OC01] major · The answer says this needs code on the machine, not the charts tools.
  evidence: text:any matches /(python|matplotlib|plotly|code)/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: absent-write:charts
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
