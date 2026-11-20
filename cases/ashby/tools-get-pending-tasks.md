# tools-get-pending-tasks
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_pending_tasks (Ashby MCP; the user's scorecards, approvals and follow-ups)
- Decision tested: What-do-I-owe is one pending-tasks read, reported by type
- Data check: the signed-in Ashby user has at least one pending task, or none, either is answerable
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what do I owe in Ashby this week? scorecards, approvals, follow-ups, the lot.

## Items
- [ASH-OC01] blocker · It read it with get_pending_tasks once.
  evidence: count:ashby.get_pending_tasks == 1
- [ASH-OC02] major · The answer lists what is pending, by type, and says so plainly if nothing is.
  evidence: text:any matches /scorecard|approval|follow|task|nothing/i
