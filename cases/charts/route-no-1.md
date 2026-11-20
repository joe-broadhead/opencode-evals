# route-no-1
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: should-not-call: reading values out of a raster image is not a charts task
- Decision tested: A read-the-numbers-off-this-PNG request reaches no charts tool, and the answer says it cannot read the image
- Data check: none
- Seed: plugins=charts
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: route

## Prompt
read the numbers off this chart PNG and put them in a table: chart.png is in the folder.

## Items
- [CHT-RT01] blocker · No charts tool was called.
  evidence: absent:charts.*
- [CHT-OC01] major · The answer says it cannot read values from a raster image.
  evidence: text:any matches /(can't|cannot|not able|no tool).{0,40}(read|image|png|raster)/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
