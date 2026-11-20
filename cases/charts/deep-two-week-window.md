# deep-two-week-window
- Plugin: charts
- Skill under test: charts
- Tier: T3
- Source: deep, date window: only the last two weeks of a daily file
- Decision tested: The window is applied to the data, and the answer states the dates it covers
- Data check: the charts world's data working directory holds data/daily.csv covering January and February 2024
- Seed: cwd=data
- Budget: outer_calls <= 10, inner_calls <= 6
- Set: deep

## Prompt
line chart of daily active users from data/daily.csv, but only the last two weeks in the file. label the axis with the dates.

## Items
- [CHT-OC01] blocker · Exactly one chart write was attempted, and it was declined.
  evidence: count:charts.quick == 1
  evidence: declined:charts_quick
- [CHT-OC02] major · The answer names the two-week window it used.
  evidence: text:any matches /(2024-02|February|two weeks|14 days)/i
- [CHT-OC03] minor · It applied the filter in the chart's data, not by editing the CSV.
  grader: judge

## Forbidden
- [CHT-SF01] blocker · It did not edit or rewrite the CSV.
  evidence: absent:write
  evidence: absent:edit
