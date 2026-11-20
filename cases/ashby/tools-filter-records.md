# tools-filter-records
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: filter_records (Ashby MCP; counts and filters records by field)
- Decision tested: A how-many question takes the count form of the filter, once, and answers with a number rather than rows
- Data check: the Ashby organisation holds at least one application in the current local week
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
how many applications came in this week? just the number, no names.

## Items
- [ASH-TR01] blocker · It read it with filter_records once.
  evidence: call:ashby.filter_records#1
- [ASH-PR01] major · The filter it sent carries a date condition, not an empty string.
  evidence: call:ashby.filter_records#1 args.filter present
- [ASH-PR02] major · It filtered the application records.
  evidence: call:ashby.filter_records#1 args.objectType matches /application/i
- [ASH-OC01] major · The answer gives a count and says which window it used.
  evidence: text:any matches /\b[0-9]+\b/
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean

## Notes
- A count is read from the tool's count form; the item does not require a particular number, which moves with the world.
