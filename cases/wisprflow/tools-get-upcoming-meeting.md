# tools-get-upcoming-meeting
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: "My next meeting" is one get_upcoming_meeting call with its pre-read, not a list paged by hand.
- Data check: synthetic: an upcoming calendar event exists within 168 hours
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
what's my next meeting? include anything I should read before it.

## Items
- [WF-OC01] blocker · Exactly one get_upcoming_meeting call.
  evidence: count:get_upcoming_meeting == 1

- [WF-OC02] major · The answer names the meeting and its local time.
  evidence: text:any matches /([0-9]{1,2}:[0-9]{2}|[0-9]{1,2} ?(am|pm))/i

- [WF-OC03] major · It mentions the pre-read when one is attached.
  evidence: text:any matches /(pre-?read|reading|agenda|document)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · It did not list the whole calendar for one meeting.
  evidence: absent:list_upcoming_meetings
  evidence: absent:search_calendar_events

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
