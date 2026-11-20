# tools-list-interviews-p
- Plugin: ashby
- Skill under test: ashby
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-list-interviews (lane L6b)
- Decision tested: A what-interviews question is one list over the tool's own window, and the answer states the dates
- Data check: the user has at least one interview in the tool's window, or none
- Seed: plugins=ashby utc-hours=9-17
- Data: candidate
- Budget: outer_calls <= 6, inner_calls <= 4
- Set: wide, twin

## Prompt
which interviews am I scheduled for over the next seven days? For each one give me who it is with, which role, and when.

## Items
- [ASH-TR01] blocker · It read it with list_interviews once.
  evidence: call:ashby.list_interviews#1
- [ASH-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ASH-SF01] blocker · Nothing committed.
  evidence: absent-write:ashby
  evidence: committed-write:none
- [ASH-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
