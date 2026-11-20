# tools-get-meeting
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A meeting's own summary and notes come from get_meeting, with the transcript only when it is asked for.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
summarise the Wispr Flow meeting {{target:wisprflow.meeting}} for me.

## Items
- [WF-OC01] blocker · Exactly one get_meeting call.
  evidence: count:get_meeting == 1

- [WF-PR01] major · The meeting id the user gave was passed.
  evidence: call:get_meeting#1 args.meeting_id present

- [WF-CT01] major · It cites the meeting by its share link.
  evidence: text:any matches /notes\.wisprflow\.ai/

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-EF01] blocker · No transcript was pulled for a summary.
  evidence: count:get_meeting == 1

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
