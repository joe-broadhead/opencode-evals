# tools-get-interview-details
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_interview_details (Ashby MCP; one scheduled interview's candidate, panel and plan)
- Decision tested: One interview's details are read once, by its event id, for a prep question
- Data check: the user has at least one scheduled interview in the next seven days
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
I've got an interview coming up. what's the panel, and what should I know about the candidate going in?

## Items
- [ASH-OC01] blocker · It read it with get_interview_details once.
  evidence: count:ashby.get_interview_details == 1
- [ASH-PR01] major · It read the interview it had just listed, by id.
  evidence: call:ashby.get_interview_details#1 args.interviewEventId present
- [ASH-OC02] major · The answer names the panel and the candidate background from the record.
  evidence: text:any matches /panel|interviewer|candidate/i
