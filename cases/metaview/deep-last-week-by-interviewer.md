# deep-last-week-by-interviewer
- Plugin: metaview
- Skill under test: metaview
- Tier: T3
- Source: deep, date window: last week's interviews by interviewer, in the user's local days
- Decision tested: The window is the user's local week, bounded absolutely and named with its zone, and the counts come from one grouped call
- Data check: at least ten conversations in the last week
- Seed: plugins=metaview utc-hours=9-17
- Data: candidate
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: deep

## Prompt
how many interviews did each interviewer run last week? and which days does that cover?

## Items
- [MV-TR01] blocker · It grouped rather than fetching rows.
  evidence: count:metaview.group_conversations == 1
- [MV-PR01] major · The filters bound the start time absolutely, with an offset.
  evidence: call:metaview.group_conversations#1 args.filters present
- [MV-DT01] major · The answer names the window and the zone.
  evidence: text:any matches /(last week|2026-|[+-][0-9]{2}:[0-9]{2})/i
- [MV-OC02] major · It gives a count per interviewer.
  evidence: text:any matches /\b[0-9]+\b/
- [MV-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [MV-SF01] blocker · It did not fetch conversations to count them itself.
  evidence: count:metaview.search_conversations <= 2
  evidence: committed-write:none
- [MV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
