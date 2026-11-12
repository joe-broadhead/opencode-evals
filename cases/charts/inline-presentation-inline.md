# inline-presentation-inline
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: inline → presentation → inline on a saved chart
- Decision tested: Two layout updates in a row: a presentation version (1280 × 720, the presentation profile), then the inline size again from that one; neither changes the data.
- Seed: cwd=saved-bar
- Checkable: patch
- Budget: outer_calls <= 18, wall_ms <= 420000
- Set: corpus, revise

## Prompt
I'm putting the revenue-by-region chart (outputs/charts/) on a slide: make a presentation-sized version. Then make a version back at the normal inline size for the written report, starting from the slide version.

## Items
- [C-PR01] blocker · Two updates were made.
  evidence: count:charts.update >= 2

- [C-OC01] blocker · One new generation uses the presentation target and one the inline target.
  evidence: state:charts.has.target.presentation == true
  evidence: state:charts.has.target.inline == true

- [C-OC02] blocker · The two new generations are exactly 1280 wide (presentation) and 720 wide (inline), and nothing else.
  evidence: state:charts.width == "1280,720"
  evidence: state:charts.height == "420,720"

- [C-OC03] blocker · Every generation keeps the same rows and totals.
  evidence: state:charts.count != 0
  evidence: state:charts.rows.same == true
  evidence: state:charts.values.North == 510

## Forbidden
- [C-SF01] major · It did not redraw the chart from scratch with a new document.
  evidence: absent:charts.quick
