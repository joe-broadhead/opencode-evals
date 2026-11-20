# tools-time-add
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_add (adds or subtracts a calendar amount, clamping month ends)
- Decision tested: A 90-days-from-today question is one time_add from today's date, not mental arithmetic
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what's the date 90 days from today?

## Items
- [UTL-OC01] blocker · It used time_add once.
  evidence: count:utilities.time_add == 1
- [UTL-PR01] major · It added 90.
  evidence: call:utilities.time_add#1 args.amount == 90
- [UTL-OC03] major · The answer gives one date.
  evidence: text:any matches /\b20[0-9]{2}-[0-9]{2}-[0-9]{2}\b|\b[0-9]{1,2} (January|February|March|April|May|June|July|August|September|October|November|December)/i
