# tools-time-zone-info
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_zone_info (offset, abbreviation and next change for one zone)
- Decision tested: A zone-details question is one time_zone_info for the zone named
- Data check: none
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
what's Lisbon's offset right now, and when do the clocks change next?

## Items
- [UTL-TR01] blocker · It used time_zone_info once.
  evidence: call:utilities.time_zone_info#1
- [UTL-PR01] major · It asked about Lisbon's zone.
  evidence: call:utilities.time_zone_info#1 args.timezone matches /lisbon/i
- [UTL-OC01] major · The answer gives the offset and the next change.
  evidence: text:any matches /(WET|WEST|UTC\+0|GMT\+0|UTC\+1|GMT\+1)/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: absent-write:utilities
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
