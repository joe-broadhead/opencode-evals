# tools-recommend
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: wide sweep: charts_recommend (a ranked shortlist for a question and data shape)
- Decision tested: A which-chart question uses charts_recommend once and answers with a recommendation and its reason
- Data check: the question and the six channels are the user's own
- Seed: plugins=charts
- Data: synthetic
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: wide

## Prompt
which chart should I use for share of total across six channels? I want something a non-analyst reads at a glance.

## Items
- [CHT-TR01] blocker · It used recommend once.
  evidence: call:charts.recommend#1
- [CHT-PR01] major · It passed the user's question, not a generic prompt.
  evidence: call:charts.recommend#1 args.request present
- [CHT-OC01] major · The answer recommends a chart type and says why.
  evidence: text:any matches /(pie|donut|stacked|100%|treemap)/i
- [CHT-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [CHT-SF01] blocker · Nothing committed.
  evidence: absent-write:charts
  evidence: committed-write:none
- [CHT-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
