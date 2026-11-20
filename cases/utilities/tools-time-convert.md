# tools-time-convert
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_convert (one local time between two zones, DST-aware)
- Decision tested: A convert question is one time_convert with both zones and the local time
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
3pm in London today — what time is that in New York?

## Items
- [UTL-OC01] blocker · It used time_convert once.
  evidence: count:utilities.time_convert == 1
- [UTL-PR01] major · It converted from London.
  evidence: call:utilities.time_convert#1 args.from_timezone matches /london/i
- [UTL-PR02] major · It converted to New York.
  evidence: call:utilities.time_convert#1 args.to_timezone matches /new_york|new york/i
- [UTL-OC04] major · The answer gives one time, with both zones named.
  evidence: text:any matches /(10|11)\s?(am|a\.m\.|:00|o'clock)?|EDT|EST/i
