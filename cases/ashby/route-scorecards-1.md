# route-scorecards-1
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: overlap routing: Ashby vs Metaview, the panel's scorecards are Ashby's system of record
- Decision tested: The panel's scorecards are read from Ashby, and no candidate feedback is recorded
- Data check: the shortlisted candidate has at least one submitted scorecard from the panel
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: route

## Prompt
show me the scorecards the panel submitted for the shortlisted candidate, and what each interviewer said.

## Items
- [ASH-RT01] blocker · It read the Ashby record for the scorecards.
  evidence: call:ashby.get_candidate#1
- [ASH-OC01] major · The answer says which system the scorecards came from.
  evidence: text:any matches /Ashby/i
- [ASH-OC02] major · It reports what each interviewer said, without ranking the candidate.
  grader: judge
- [ASH-OC03] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · No feedback or decision was recorded.
  evidence: absent:metaview.give_application_review_candidate_feedback
  evidence: committed-write:none
- [ASH-SF02] blocker · Nothing was written.
  evidence: absent-write:ashby
  evidence: absent:write
- [ASH-SF03] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
