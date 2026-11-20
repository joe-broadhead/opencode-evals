# tools-list-upcoming-meetings
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: The next three days are one list_upcoming_meetings call with a window, not a day-by-day loop.
- Data check: synthetic: upcoming events exist in the window
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
what's coming up in the next three days?

## Items
- [WF-OC01] blocker · Exactly one list_upcoming_meetings call.
  evidence: count:list_upcoming_meetings == 1

- [WF-OC02] major · The window is three days, not the default day.
  evidence: call:list_upcoming_meetings#1 args.window_hours == 72

- [WF-OC03] major · The answer lists the events with local times.
  evidence: text:any matches /([0-9]{1,2}:[0-9]{2}|[0-9]{1,2} ?(am|pm))/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · No second window call.
  evidence: absent:list_upcoming_meetings#2

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
