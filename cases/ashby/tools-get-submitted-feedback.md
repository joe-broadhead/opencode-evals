# tools-get-submitted-feedback
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_submitted_feedback (Ashby MCP; the user's own scorecards for an application)
- Decision tested: My-own-scorecards is one submitted-feedback read by application id, and it says these are only the user's
- Data check: the user has submitted a scorecard for the shortlisted candidate's application
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what did I score on the shortlisted candidate's onsite? my own scorecard, not the panel's.

## Items
- [ASH-TR01] blocker · It read it with get_submitted_feedback once.
  evidence: call:ashby.get_submitted_feedback#1
- [ASH-PR01] major · It read the application it resolved, by id.
  evidence: call:ashby.get_submitted_feedback#1 args.applicationId present
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
