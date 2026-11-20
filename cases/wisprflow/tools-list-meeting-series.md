# tools-list-meeting-series
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A recurring meeting's instances come from list_meeting_series with the meeting's own id.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
show me every instance of the weekly pricing call, meeting {{target:wisprflow.meeting}}.

## Items
- [WF-OC01] blocker · Exactly one list_meeting_series call.
  evidence: count:list_meeting_series == 1

- [WF-PR01] major · The meeting id the user gave was passed.
  evidence: call:list_meeting_series#1 args.meeting_id present

- [WF-OC02] major · The answer lists the instances by date.
  evidence: text:any matches /([0-9]{1,2} (Nov|November|Oct|October)|[0-9]{4}-[0-9]{2}-[0-9]{2})/

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
