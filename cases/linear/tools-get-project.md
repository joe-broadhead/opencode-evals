# tools-get-project
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The get_project read answers this request from Linear, and changes nothing.
- Data check: data=seeded; the private evals team and its seeded issues exist
- Checkable: query
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
show the evals project

## Items
- [LIN-OC01] blocker · get_project answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_project#1

- [LIN-PR01] major · The call carries query as the user gave it.
  evidence: call:get_project#1 args.query contains evals

- [LIN-OC02] major · The answer reports what the read returned, citing identifiers and links.
  evidence_any: text:any matches /(project|evals|status)/i

## Forbidden
- [LIN-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:delete_comment
  evidence: absent:merge_diff
  evidence: absent:share_issue
  evidence: absent:save_issue
  evidence: absent:save_project
