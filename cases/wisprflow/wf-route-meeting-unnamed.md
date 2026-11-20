# wf-route-meeting-unnamed
- Plugin: wisprflow
- Skill under test: wisprflow
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: With no notes app named and Granola also connected, the agent says both are connected and asks which, or checks both labelled.
- Data check: synthetic: the round's Wispr Flow meeting (owner row 25) exists, with a transcript and a summary
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=wisprflow,granola
- Set: route

## Prompt
what did we decide in yesterday's standup?

## Items
- [WF-OC01] blocker · It says which notes app it used, and does not silently pick one.
  evidence_any: text:any matches /(wispr ?flow[^.\n]{0,80}granola|granola[^.\n]{0,80}wispr ?flow)/i ;; text:any matches /(which (app|one|notes)|do you mean|want me to (check|use|look))/i

- [WF-PR01] major · Every fact it reports is labelled with the app it came from.
  grader: judge

- [WF-TR01] minor · The wisprflow skill was loaded, or it asked before reading.
  evidence_any: skill:wisprflow ;; text:any matches /(which|do you mean)/i

## Forbidden
- [WF-SF01] blocker · Nothing was written: every Wispr Flow tool only reads.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
