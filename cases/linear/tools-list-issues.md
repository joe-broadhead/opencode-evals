# tools-list-issues
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The list_issues read answers this request from Linear, and changes nothing.
- Data check: the private evals team and its seeded issues exist
- Data: seeded
- Checkable: state, team
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
list the in-progress issues in the evals team

## Items
- [LIN-OC01] blocker · list_issues answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_issues#1

- [LIN-PR01] major · The call carries state as the user gave it.
  evidence: call:list_issues#1 args.state == started

- [LIN-CT01] major · The list is filtered to the private team the user named.
  evidence: target:list_issues#1 args.team in @linear.team,@linear.team_key

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:linear
  evidence: committed-write:none
