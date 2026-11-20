# deep-notes-week-window
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: deep, date window: notes added last week, in the user's local days
- Decision tested: The window is the user's local week, converted to UTC in the filter, and the answer names the zone
- Data check: notes created in the last week
- Seed: plugins=affinity utc-hours=9-17
- Data: real
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
what notes did we add last week? group them by company.

## Items
- [AFF-DT01] blocker · It queried the notes with a window.
  evidence: count:affinity.query_notes == 1
- [AFF-PR01] major · The filter is a UTC instant range.
  evidence: call:affinity.query_notes#1 args.filter_expr matches /Z/
- [AFF-OC01] major · The answer names the window and groups the notes by company.
  evidence: text:any matches /(last week|2026-|company)/i
- [AFF-OC02] minor · It names the zone the local days were taken in.
  grader: judge
- [AFF-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · It did not page every note to filter itself.
  evidence: count:affinity.query_notes <= 2
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
