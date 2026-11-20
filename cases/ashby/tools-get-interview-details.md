# tools-get-interview-details
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_interview_details (Ashby MCP; one scheduled interview's candidate, panel and plan)
- Decision tested: One interview's details are read once, by its event id, for a prep question
- Data check: the user has at least one scheduled interview in the next seven days
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
I've got an interview coming up. what's the panel, and what should I know about the candidate going in?

## Items
- [ASH-TR01] blocker · It read it with get_interview_details once.
  evidence: call:ashby.get_interview_details#1
- [ASH-PR01] major · It read the interview it had just listed, by id.
  evidence: call:ashby.get_interview_details#1 args.interviewEventId present
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
