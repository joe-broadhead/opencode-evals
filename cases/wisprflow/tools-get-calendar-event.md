# tools-get-calendar-event
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: One calendar event's details come from get_calendar_event, with its attendees and location.
- Data check: synthetic: the round's Wispr Flow meeting (owner row 25) exists, with a transcript and a summary
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
pull up the calendar event <the calendar event id> and tell me who is invited and where it is.

## Items
- [WF-OC01] blocker · Exactly one get_calendar_event call.
  evidence: count:get_calendar_event == 1

- [WF-OC02] major · It read one event, for the id the user gave.
  evidence: count:get_calendar_event == 1

- [WF-OC03] major · The answer names attendees and a location.
  evidence: text:any matches /(@|attendee|invited|location|room|meet\.google|zoom)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
