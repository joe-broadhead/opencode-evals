# tools-time-convert
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_convert (one local time between two zones, DST-aware)
- Decision tested: A convert question is one time_convert with both zones and the local time
- Data check: none
- Seed: plugins=utilities utc-hours=9-17
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
3pm in London today — what time is that in New York?

## Items
- [UTL-TR01] blocker · It used time_convert once.
  evidence: call:utilities.time_convert#1
- [UTL-PR01] major · It converted from London.
  evidence: call:utilities.time_convert#1 args.from_timezone matches /london/i
- [UTL-PR02] major · It converted to New York.
  evidence: call:utilities.time_convert#1 args.to_timezone matches /new_york|new york/i
- [UTL-OC01] major · The answer gives one time, with both zones named.
  evidence: text:any matches /(10|11)\s?(am|a\.m\.|:00|o'clock)?|EDT|EST/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
