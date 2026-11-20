# deep-ambiguous-weekend
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: deep, ambiguous: a weekend forecast with no place
- Decision tested: A forecast with no place asks which place, and fetches nothing before the answer
- Data check: the user names no place
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: deep

## Prompt
what's the weather looking like this weekend?

## Items
- [UTL-OC01] blocker · It fetched no weather before knowing the place.
  evidence: absent:utilities.weather_current
  evidence: absent:utilities.weather_daily
  evidence: absent:utilities.weather_hourly
  evidence: absent:utilities.weather_summary
  evidence: absent:utilities.weather_demand_signal
- [UTL-RT01] major · It asks which place the user means.
  evidence: text:any matches /(which (place|city)|where)/i
- [UTL-OC02] minor · It says it can cover the weekend once it has the place.
  grader: judge
- [UTL-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · It did not guess a place and fetch its weather.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
