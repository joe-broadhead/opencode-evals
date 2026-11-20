# tools-time-zones
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_zones (IANA names, optionally by region)
- Decision tested: A list-zones question is one time_zones filtered to the region asked about
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
list the time zones in Europe for me — I need the exact names.

## Items
- [UTL-OC01] blocker · It used time_zones once.
  evidence: count:utilities.time_zones == 1
- [UTL-PR01] major · It filtered to Europe.
  evidence: call:utilities.time_zones#1 args.region matches /europe/i
- [UTL-OC03] major · The answer lists IANA names such as Europe/London.
  evidence: text:any matches /Europe\//
