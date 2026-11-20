# tools-time-zones
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_zones (IANA names, optionally by region)
- Decision tested: A list-zones question is one time_zones filtered to the region asked about
- Data check: none
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
list the time zones in Europe for me — I need the exact names.

## Items
- [UTL-TR01] blocker · It used time_zones once.
  evidence: call:utilities.time_zones#1
- [UTL-PR01] major · It filtered to Europe.
  evidence: call:utilities.time_zones#1 args.region matches /europe/i
- [UTL-OC01] major · The answer lists IANA names such as Europe/London.
  evidence: text:any matches /Europe\//
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
