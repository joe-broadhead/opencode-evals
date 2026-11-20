# tools-get-meeting
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A meeting's own summary and notes come from get_meeting, with the transcript only when it is asked for.
- Data check: synthetic: the round's Wispr Flow meeting (owner row 25) exists, with a transcript and a summary
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: wide

## Prompt
summarise the Wispr Flow meeting <the meeting id> for me.

## Items
- [WF-OC01] blocker · Exactly one get_meeting call.
  evidence: count:get_meeting == 1

- [WF-OC02] major · The meeting id the user gave was passed.
  evidence: call:get_meeting#1 args.meeting_id present

- [WF-OC03] major · The answer gives a summary and labels it as Wispr Flow's.
  evidence: text:any matches /(summary|summarised|Wispr Flow)/i

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · No transcript was pulled for a summary.
  evidence: absent-arg:get_meeting args.view_transcript present

- [WF-SF02] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
