# tools-search-calendar-events
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A day's calendar is one search_calendar_events call bounded by that day's local start and end.
- Data check: the day holds one event
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow utc-hours=9-17
- Set: wide

## Prompt
what's on my calendar today?

## Items
- [WF-OC01] blocker · Exactly one search_calendar_events call.
  evidence: count:search_calendar_events == 1

- [WF-PR01] major · The call is bounded by the day's start and end.
  evidence: call:search_calendar_events#1 args.since present
  evidence: call:search_calendar_events#1 args.until present

- [WF-OC02] major · The answer lists the day's events in local time.
  evidence: text:any matches /([0-9]{1,2}:[0-9]{2}|[0-9]{1,2} ?(am|pm))/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-EF01] blocker · No second day's window.
  evidence: absent:search_calendar_events#2

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
