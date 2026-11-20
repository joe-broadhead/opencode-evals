# tools-get-meeting-by-calendar-id
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A calendar event's recording is found by its calendar id, and "not recorded" is reported as such.
- Data check: synthetic: the round's Wispr Flow meeting (owner row 25) exists, with a transcript and a summary
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
we had a call booked as calendar event <the calendar event id> — was it recorded, and what came out of it?

## Items
- [WF-OC01] blocker · Exactly one get_meeting_by_calendar_id call.
  evidence: count:get_meeting_by_calendar_id == 1

- [WF-OC02] major · It looked the recording up by the calendar event.
  evidence: count:get_meeting_by_calendar_id == 1

- [WF-OC03] major · The answer says whether it was recorded.
  evidence: text:any matches /(recorded|not recorded|recording)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
