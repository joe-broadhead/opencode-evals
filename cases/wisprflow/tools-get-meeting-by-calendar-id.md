# tools-get-meeting-by-calendar-id
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A calendar event's recording is found by its calendar id, and "not recorded" is reported as such.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
we had a call booked as the calendar event for {{target:wisprflow.meeting}} — was it recorded, and what came out of it?

## Items
- [WF-OC01] blocker · Exactly one get_meeting_by_calendar_id call.
  evidence: count:get_meeting_by_calendar_id == 1

- [WF-OC02] major · The answer says whether it was recorded, citing the notes when it was.
  evidence_any: text:any matches /notes\.wisprflow\.ai/ ;; text:any matches /(was not|wasn't|not) recorded/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
