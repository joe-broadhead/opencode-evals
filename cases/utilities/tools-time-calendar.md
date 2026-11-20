# tools-time-calendar
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_calendar (weekday, ISO week, quarter for a date)
- Decision tested: A what-weekday question is one time_calendar for the date
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what weekday is 14 March 2027, and which ISO week is that?

## Items
- [UTL-OC01] blocker · It used time_calendar once.
  evidence: count:utilities.time_calendar == 1
- [UTL-PR01] major · It passed the date the user gave.
  evidence: call:utilities.time_calendar#1 args.date matches /2027-03-14/
- [UTL-OC03] major · The answer gives the weekday and the ISO week.
  evidence: text:any matches /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday).{0,40}(week|11)/is
