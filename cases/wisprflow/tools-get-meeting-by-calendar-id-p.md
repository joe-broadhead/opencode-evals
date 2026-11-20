# tools-get-meeting-by-calendar-id-p
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-get-meeting-by-calendar-id (lane L6b)
- Decision tested: A calendar event's recording is found by its calendar id, and "not recorded" is reported as such.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide, twin

## Prompt
the calendar entry for {{target:wisprflow.meeting}} was a call of mine; did Wispr Flow capture it, and what was the outcome?

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
