# tools-time-holidays
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_holidays (offline public holidays, 2000 to 2030)
- Decision tested: An is-it-a-holiday question is one time_holidays check for the date and country
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
is 25 December 2026 a public holiday in England?

## Items
- [UTL-OC01] blocker · It used time_holidays once.
  evidence: count:utilities.time_holidays == 1
- [UTL-PR01] major · It checked one date.
  evidence: call:utilities.time_holidays#1 args.mode == check
- [UTL-PR02] major · It passed the country and region the user meant.
  evidence: call:utilities.time_holidays#1 args.country matches /gb|uk/i
- [UTL-OC04] major · The answer says yes, it is a holiday, and names it.
  evidence: text:any matches /(yes|Christmas|holiday)/i
