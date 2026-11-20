# tools-get-calendar-event
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: One calendar event's details come from get_calendar_event, with its attendees and location.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide
- Status: deferred

## Prompt
pull up the calendar event for {{target:wisprflow.meeting}} and tell me who is invited and where it is.

## Items
- [WF-OC01] blocker · Exactly one get_calendar_event call.
  evidence: count:get_calendar_event == 1

- [WF-OC02] major · The answer names attendees and a location.
  evidence: text:any matches /([0-9]{1,2}:[0-9]{2}|[0-9]{1,2} ?(am|pm)|@[A-Za-z0-9._%+-]+)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none

## Notes
- Deferred: needs a recorded meeting behind the calendar event (owner decision 20 Nov).
