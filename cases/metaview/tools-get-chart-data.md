# tools-get-chart-data
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: wide sweep: get_chart_data (a chart's numbers for a report)
- Decision tested: A chart-my-numbers question is one get_chart_data with chart inputs, not a row fetch
- Data check: candidate data: the workspace has conversations in the last month
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
give me the numbers for interviews per week over the last month — I want to chart them.

## Items
- [MV-OC01] blocker · It used get_chart_data once.
  evidence: count:metaview.get_chart_data == 1
- [MV-PR01] major · The call carries a generic rationale, with no candidate detail in it.
  evidence: call:metaview.get_chart_data#1 args.rationale present
- [MV-PR02] major · It passed the chart's inputs.
  evidence: call:metaview.get_chart_data#1 args.chart_inputs present
- [MV-OC04] major · The answer gives weekly numbers.
  evidence: text:any matches /(week|\b[0-9]+\b)/i
