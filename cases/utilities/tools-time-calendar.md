# tools-time-calendar
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_calendar (weekday, ISO week, quarter for a date)
- Decision tested: A what-weekday question is one time_calendar for the date
- Data check: none
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what weekday is 14 March 2027, and which ISO week is that?

## Items
- [UTL-TR01] blocker · It used time_calendar once.
  evidence: call:utilities.time_calendar#1
- [UTL-PR01] major · It passed the date the user gave.
  evidence: call:utilities.time_calendar#1 args.date matches /2027-03-14/
- [UTL-OC01] major · The answer gives the weekday and the ISO week.
  evidence: text:any matches /(Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday).{0,40}(week|11)/is
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
