# tools-list-issues
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The list_issues read answers this request from Linear, and changes nothing.
- Data check: data=seeded; the private evals team and its seeded issues exist
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

- [LIN-PR02] major · The call carries team as the user gave it.
  evidence: call:list_issues#1 args.team contains {{target:linear.team_key}}

- [LIN-OC02] major · The answer reports what the read returned, citing identifiers and links.
  evidence_any: text:any matches /(issue|progress|title)/i

## Forbidden
- [LIN-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:delete_comment
  evidence: absent:merge_diff
  evidence: absent:share_issue
  evidence: absent:save_issue
  evidence: absent:save_project
