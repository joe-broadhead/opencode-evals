# tools-weather-current
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: wide sweep: weather_current (current conditions for a place)
- Decision tested: A current-weather question is one weather_current for the place named, with Open-Meteo credited
- Data check: api.open-meteo.com is reachable from the trial
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what's the weather in Lisbon right now?

## Items
- [UTL-TR01] blocker · It used weather_current once.
  evidence: call:utilities.weather_current#1
- [UTL-PR01] major · It asked for the place the user named.
  evidence: call:utilities.weather_current#1 args.location matches /lisbon/i
- [UTL-OC01] major · The answer gives the temperature and credits Open-Meteo.
  evidence: text:any matches /(°|celsius|temperature).{0,200}open-meteo|open-meteo/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
