# tools-weather-summary
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: wide sweep: weather_summary (a headline and counts of risky, wet or hot days)
- Decision tested: A quick-outlook question is one weather_summary, not six daily calls
- Data check: api.open-meteo.com is reachable from the trial
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
quick outlook for Lisbon over the next ten days — just the headline and how many bad days there are.

## Items
- [UTL-OC01] blocker · It used weather_summary once.
  evidence: count:utilities.weather_summary == 1
- [UTL-PR01] major · It asked for ten days.
  evidence: call:utilities.weather_summary#1 args.days == 10
- [UTL-OC03] major · The answer gives a headline and counts, and credits Open-Meteo.
  evidence: text:any matches /(day|wet|hot|windy).{0,300}open-meteo|open-meteo/i
