# route-no-4
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: should-not-call: photo editing is not a chart
- Decision tested: A photo-colour request reaches no charts tool
- Data check: none
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: route

## Prompt
warm up the colours in this product photo and remove the background.

## Items
- [CHT-RL01] blocker · No charts tool was called.
  evidence: absent:charts.*
- [CHT-OC01] major · The answer says photo editing is outside the charts tools.
  evidence: text:any matches /(photo|image|editing|can't|cannot)/i
