# tools-time-now
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_now (current time in IANA zones, plus the machine's zone)
- Decision tested: A what-time-is-it question is one time_now with both zones named
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what time is it in Tokyo right now, and what's the date here?

## Items
- [UTL-OC01] blocker · It used time_now once.
  evidence: count:utilities.time_now == 1
- [UTL-PR01] major · It asked for Tokyo.
  evidence: call:utilities.time_now#1 args.timezones present
- [UTL-OC03] major · The answer gives Tokyo's time and this machine's date and zone.
  evidence: text:any matches /(Tokyo|JST|Asia\/Tokyo)/i
