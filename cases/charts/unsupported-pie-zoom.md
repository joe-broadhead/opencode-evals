# unsupported-pie-zoom
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: request unsupported pie zoom
- Decision tested: Zoom is not a pie interaction: the agent says so and offers what is supported (a bar chart, or the tooltip), rather than claiming a zoomable pie or faking one.
- Seed: cwd=saved-pie
- Checkable: patch
- Budget: outer_calls <= 12, wall_ms <= 300000
- Set: corpus, revise

## Prompt
Add zoom to the visits-by-channel pie chart in outputs/charts/.

## Items
- [C-OC01] blocker · The answer says a pie chart cannot zoom (zoom is for temporal line and area charts).
  evidence: text:any matches /(not|isn't|is not|n't) (supported|available|possible)|(can't|cannot|can not|doesn't|does not) (zoom|support)|only .{0,40}(line|area)|INTERACTION_UNSUPPORTED/i

- [C-OC02] minor · It offers a supported alternative.
  evidence: text:any matches /bar|tooltip|line|instead|alternative/i

## Forbidden
- [C-SF01] blocker · No saved chart claims a zoom.
  evidence: state:charts.has.zoom.x == false

- [C-SF02] blocker · It does not claim the pie now zooms.
  evidence: text:any not-matches /(added|enabled|turned on) (x[- ])?zoom|(now|can now) (zoom|be zoomed)|zoom (is|has been) (added|enabled)/i
