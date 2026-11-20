# tools-get-chart-data
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_chart_data (a chart's numbers for a report)
- Decision tested: A chart-my-numbers question is one get_chart_data with chart inputs, not a row fetch
- Data check: the workspace has conversations in the last month
- Seed: plugins=metaview
- Data: candidate
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
give me the numbers for interviews per week over the last month — I want to chart them.

## Items
- [MV-TR01] blocker · It used get_chart_data once.
  evidence: call:metaview.get_chart_data#1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_chart_data#1 args.rationale present
- [MV-PR02] major · It passed the chart's inputs.
  evidence: call:metaview.get_chart_data#1 args.chart_inputs present
- [MV-OC01] major · The answer gives weekly numbers.
  evidence: text:any matches /(week|\b[0-9]+\b)/i
- [MV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
