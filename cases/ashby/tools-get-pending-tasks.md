# tools-get-pending-tasks
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: get_pending_tasks (Ashby MCP; the user's scorecards, approvals and follow-ups)
- Decision tested: What-do-I-owe is one pending-tasks read, reported by type
- Data check: the signed-in Ashby user has at least one pending task, or none, either is answerable
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what do I owe in Ashby this week? scorecards, approvals, follow-ups, the lot.

## Items
- [ASH-TR01] blocker · It read it with get_pending_tasks once.
  evidence: call:ashby.get_pending_tasks#1
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
