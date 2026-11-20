# route-no-3
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: should-not-call: a 3-D scientific surface belongs to code, not charts
- Decision tested: A 3-D surface request reaches no charts tool, and the answer points at code
- Data check: none
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: route

## Prompt
plot z = sin(x) * cos(y) as a 3-D surface, 60 by 60, with a colour map.

## Items
- [CHT-RL01] blocker · No charts tool was called.
  evidence: absent:charts.*
- [CHT-OC01] major · The answer says this needs code on the machine, not the charts tools.
  evidence: text:any matches /(python|matplotlib|code|3-d|three-dimensional)/i
