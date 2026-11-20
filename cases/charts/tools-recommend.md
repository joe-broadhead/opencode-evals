# tools-recommend
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_recommend (a ranked shortlist for a question and data shape)
- Decision tested: A which-chart question uses charts_recommend once and answers with a recommendation and its reason
- Data check: none: the question and the six channels are the user's own
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
which chart should I use for share of total across six channels? I want something a non-analyst reads at a glance.

## Items
- [CHT-OC01] blocker · It used recommend once.
  evidence: count:charts.recommend == 1
- [CHT-PR01] major · It passed the user's question, not a generic prompt.
  evidence: call:charts.recommend#1 args.request present
- [CHT-OC03] major · The answer recommends a chart type and says why.
  evidence: text:any matches /(pie|donut|bar|treemap|share)/i
