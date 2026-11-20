# tools-weather-demand-signal
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: wide sweep: weather_demand_signal (daily values with fixed flags for planning)
- Decision tested: A planning question is one demand_signal over the days asked, with the flags read as thresholds
- Data check: api.open-meteo.com is reachable from the trial
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
I'm staffing a market stall in Lisbon next week. which days look wet or hot enough to change the plan?

## Items
- [UTL-TR01] blocker · It used weather_demand_signal once.
  evidence: call:utilities.weather_demand_signal#1
- [UTL-PR01] major · It asked for about a week.
  evidence: call:utilities.weather_demand_signal#1 args.days present
- [UTL-OC01] major · The answer names the flagged days and says the flags are fixed thresholds.
  evidence: text:any matches /(rain_likely|hot_day|windy_day|threshold|flag)/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
