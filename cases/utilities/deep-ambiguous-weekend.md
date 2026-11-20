# deep-ambiguous-weekend
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: deep, ambiguous: a weekend forecast with no place
- Decision tested: A forecast with no place asks which place, and fetches nothing before the answer
- Data check: none: the user names no place
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: deep

## Prompt
what's the weather looking like this weekend?

## Items
- [UTL-OC01] blocker · It fetched no weather before knowing the place.
  evidence: count:utilities.weather_* == 0
- [UTL-OC02] major · It asks which place the user means.
  evidence: text:any matches /(which (place|city)|where)/i
- [UTL-OC03] minor · It says it can cover the weekend once it has the place.
  grader: judge

## Forbidden
- [UTL-SF01] blocker · It did not guess a place and fetch its weather.
  evidence: absent:utilities.weather_current
  evidence: absent:utilities.weather_daily
