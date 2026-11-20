# tools-get-submitted-feedback
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_submitted_feedback (Ashby MCP; the user's own scorecards for an application)
- Decision tested: My-own-scorecards is one submitted-feedback read by application id, and it says these are only the user's
- Data check: the user has submitted a scorecard for {{target:ashby.candidate}}'s application
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what did I score on {{target:ashby.candidate}}'s onsite? my own scorecard, not the panel's.

## Items
- [ASH-OC01] blocker · It read it with get_submitted_feedback once.
  evidence: count:ashby.get_submitted_feedback == 1
- [ASH-PR01] major · It read the application it resolved, by id.
  evidence: call:ashby.get_submitted_feedback#1 args.applicationId present
- [ASH-OC02] major · The answer says these are the user's own scorecards.
  evidence: text:any matches /your|own|you submitted/i
