# deep-wf-vague-catchup
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.3 deep: ambiguous
- Decision tested: An unscoped "catch me up" is a question about the period, or one bounded list with the period stated, never a walk of everything.
- Data check: the round's Wispr Flow meeting exists (owner row 25), with a transcript and a summary
- Data: real
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow
- Set: deep

## Prompt
catch me up on my meetings

## Items
- [WF-OC01] blocker · It asks which period, or states the window it used.
  evidence: text:any matches /(which (period|week|days)|last (week|seven|7|30)|recent|upcoming|\?)/i

- [WF-EF01] blocker · It did not read every transcript.
  evidence: count:get_meeting <= 2

- [WF-EF02] major · At most two list calls.
  evidence: count:search_meetings <= 2
  evidence: count:list_upcoming_meetings <= 1

- [WF-TR01] minor · The wisprflow skill was loaded.
  evidence: skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [WF-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
