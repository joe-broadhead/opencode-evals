# tools-weather-daily
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: wide sweep: weather_daily (a daily forecast up to 16 days)
- Decision tested: A weekend question is one weather_daily with enough days to reach the last day asked
- Data check: api.open-meteo.com is reachable from the trial
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
will it rain in Lisbon this weekend? give me the daily numbers, not a summary.

## Items
- [UTL-OC01] blocker · It used weather_daily once.
  evidence: count:utilities.weather_daily == 1
- [UTL-PR01] major · It asked for enough days to reach the weekend.
  evidence: call:utilities.weather_daily#1 args.days present
- [UTL-OC03] major · The answer gives a precipitation chance or amount per day, and credits Open-Meteo.
  evidence: text:any matches /(mm|%|rain).{0,300}open-meteo|open-meteo/i
