# tools-list-issue-labels
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The list_issue_labels read answers this request from Linear, and changes nothing.
- Data check: the private evals team and its seeded issues exist; content unchecked
- Data: seeded
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
list the issue labels in the {{target:linear.team_key}} team

## Items
- [LIN-OC01] blocker · list_issue_labels answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_issue_labels#1

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:linear
  evidence: committed-write:none
