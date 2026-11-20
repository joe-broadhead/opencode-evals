# tools-time-between
- Plugin: utilities
- Skill under test: utilities-time
- Tier: T3
- Source: wide sweep: time_between (signed difference between two dates)
- Decision tested: A how-long-between question is one time_between
- Data check: none
- Seed: plugins=utilities
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6
- Set: wide

## Prompt
how long is it between 3 January 2027 and 14 April 2027? days is fine.

## Items
- [UTL-TR01] blocker · It used time_between once.
  evidence: call:utilities.time_between#1
- [UTL-PR01] major · It passed the first date.
  evidence: call:utilities.time_between#1 args.from present
- [UTL-OC01] major · The answer gives the difference in days.
  evidence: text:any matches /\b10[0-9]\b|\bdays\b/i
- [UTL-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [UTL-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [UTL-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
