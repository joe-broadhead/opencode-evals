# tools-time-zone-info
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_zone_info (offset, abbreviation and next change for one zone)
- Decision tested: A zone-details question is one time_zone_info for the zone named
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what's Lisbon's offset right now, and when do the clocks change next?

## Items
- [UTL-OC01] blocker · It used time_zone_info once.
  evidence: count:utilities.time_zone_info == 1
- [UTL-PR01] major · It asked about Lisbon's zone.
  evidence: call:utilities.time_zone_info#1 args.timezone matches /lisbon/i
- [UTL-OC03] major · The answer gives the offset and the next change.
  evidence: text:any matches /(UTC|GMT|\+0|\+1|offset|change)/i
