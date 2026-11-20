# wf-no-granola
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A Granola meeting is Granola's: no Wispr Flow call, and no claim that the two hold the same notes.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=wisprflow,granola
- Set: route

## Prompt
summarise my Granola meeting from yesterday

## Items
- [WF-OC01] blocker · No Wispr Flow tool call.
  evidence: count:wisprflow.* == 0

- [WF-OC02] major · It uses Granola, or says Granola holds that meeting.
  evidence: text:any matches /granola/i

- [WF-TR01] minor · No Wispr Flow skill loaded when Granola is named.
  evidence: absent-skill:wisprflow

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
