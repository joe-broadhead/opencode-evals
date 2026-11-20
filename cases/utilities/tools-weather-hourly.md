# tools-weather-hourly
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: wide sweep: weather_hourly (the next hours, up to 384)
- Decision tested: A next-hours question is one weather_hourly with an hour count, not a daily forecast
- Data check: api.open-meteo.com is reachable from the trial
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what are the next 12 hours in Lisbon like? I'm deciding whether to cycle in.

## Items
- [UTL-TR01] blocker · It used weather_hourly once.
  evidence: call:utilities.weather_hourly#1
- [UTL-PR01] major · It asked for about twelve hours.
  evidence: call:utilities.weather_hourly#1 args.hours == 12
- [UTL-OC01] major · The answer is hourly, with rain chance and wind, and credits Open-Meteo.
  evidence: text:any matches /(hour|wind|rain|precipitation).{0,300}open-meteo|open-meteo/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
