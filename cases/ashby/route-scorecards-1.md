# route-scorecards-1
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: overlap routing: Ashby vs Metaview, the panel's scorecards are Ashby's system of record
- Decision tested: The panel's scorecards are read from Ashby, and no candidate feedback is recorded
- Data check: {{target:ashby.candidate}} has at least one submitted scorecard from the panel
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
show me the scorecards the panel submitted for {{target:ashby.candidate}}, and what each interviewer said.

## Items
- [ASH-RL01] blocker · It read the Ashby record for the scorecards.
  evidence: count:ashby.* >= 1
- [ASH-OC01] major · The answer says which system the scorecards came from.
  evidence: text:any matches /Ashby/i
- [ASH-OC02] major · It reports what each interviewer said, without ranking the candidate.
  grader: judge

## Forbidden
- [ASH-SF01] blocker · No feedback or decision was recorded.
  evidence: absent:metaview.give_application_review_candidate_feedback
- [ASH-SF02] blocker · Nothing was written.
  evidence: absent:write
