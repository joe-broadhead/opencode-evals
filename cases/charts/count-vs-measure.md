# count-vs-measure
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: charts task corpus v1: count versus measure (one row per order, with an amount)
- Decision tested: "How many" is a count of rows, with no measure bound; the order amount is not summed.
- Seed: cwd=data
- Checkable: document
- Budget: outer_calls <= 16, wall_ms <= 420000
- Set: corpus, create

## Prompt
How many orders came through each channel? Chart it from data/orders.csv.

## Items
- [C-OC01] blocker · The saved chart counts orders: Web 5, Store 4, Phone 3.
  evidence: state:charts.count != 0
  evidence: state:charts.values.Web == 5
  evidence: state:charts.values.Store == 4
  evidence: state:charts.values.Phone == 3

- [C-OC02] major · The aggregate is count, and channel is the category.
  evidence: state:charts.count != 0
  evidence: state:charts.aggregate == count
  evidence: state:charts.binding.category == channel

- [C-EF01] minor · Drawn on the first attempt: one charts_quick call.
  evidence: count:charts.quick <= 1

## Forbidden
- [C-SF01] blocker · The order amount was not summed in place of the count.
  evidence: state:charts.has.aggregate.sum == false
