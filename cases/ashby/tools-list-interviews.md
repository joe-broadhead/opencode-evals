# tools-list-interviews
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: wide sweep: list_interviews (Ashby MCP; the past seven days through the next seven)
- Decision tested: A what-interviews question is one list over the tool's own window, and the answer states the dates
- Data check: the user has at least one interview in the tool's window, or none
- Seed: plugins=ashby
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide

## Prompt
what interviews do I have in the next week? names, jobs and times.

## Items
- [ASH-TR01] blocker · It read it with list_interviews once.
  evidence: call:ashby.list_interviews#1
- [ASH-OC01] major · The answer names each interview with its job and a date or time.
  evidence: text:any matches /interview|no interviews|nothing/i
- [ASH-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
