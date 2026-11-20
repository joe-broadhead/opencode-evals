# tools-weather-geocode
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: wide sweep: weather_geocode (places by name, with region and country)
- Decision tested: A shared place name is geocoded once and the matches are shown for the user to choose
- Data check: none: 'Springfield' is shared by several places
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
I need the weather for Springfield next week, but I know there are several. which ones are you finding?

## Items
- [UTL-OC01] blocker · It used weather_geocode once.
  evidence: count:utilities.weather_geocode == 1
- [UTL-PR01] major · It searched the name the user gave.
  evidence: call:utilities.weather_geocode#1 args.query matches /springfield/i
- [UTL-OC03] major · The answer shows more than one match with its region, and asks which one.
  evidence: text:any matches /(which|more than one|several|\b[A-Z]{2}\b)/
