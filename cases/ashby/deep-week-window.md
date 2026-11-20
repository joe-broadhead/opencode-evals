# deep-week-window
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: deep, date window: applications since the user's Monday, local days
- Decision tested: The window is the user's local week, the end exclusive, and the answer names it
- Data check: the Ashby organisation holds applications in the current local week
- Seed: plugins=ashby utc-hours=9-17
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: deep

## Prompt
how many applications have we had since Monday? and which jobs are they for?

## Items
- [ASH-TR01] blocker · It counted with one filter call.
  evidence: count:ashby.filter_records == 1
- [ASH-PR01] major · The filter carries a date range.
  evidence: call:ashby.filter_records#1 args.filter present
- [ASH-DT01] major · The answer names the window it used, with the user's local days.
  evidence: text:any matches /2026-[0-9]{2}-[0-9]{2}/
- [ASH-RT01] minor · It gives the count by job, or says which jobs the applications are for.
  grader: judge
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · It did not fetch rows to count them itself.
  evidence: absent-write:ashby
  evidence: count:ashby.filter_records <= 2
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
