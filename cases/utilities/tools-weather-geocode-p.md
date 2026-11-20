# tools-weather-geocode-p
- Plugin: utilities
- Skill under test: utilities-weather
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-weather-geocode (lane L6b)
- Decision tested: A shared place name is geocoded once and the matches are shown for the user to choose
- Data check: 'Springfield' is shared by several places
- Seed: plugins=utilities utc-hours=9-17
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide, twin

## Prompt
next week's forecast for Springfield is what I'm after, but there are lots of places with that name; show me which ones you can match.

## Items
- [UTL-TR01] blocker · It used weather_geocode once.
  evidence: call:utilities.weather_geocode#1
- [UTL-PR01] major · It searched the name the user gave.
  evidence: call:utilities.weather_geocode#1 args.query matches /springfield/i
- [UTL-OC01] major · The answer shows more than one match with its region, and asks which one.
  evidence: text:any count /Springfield/i >= 2
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
