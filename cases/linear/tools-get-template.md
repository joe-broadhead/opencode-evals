# tools-get-template
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The get_template read answers this request from Linear, and changes nothing.
- Data check: data=seeded; the private evals team and its seeded issues exist
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
show the bug template

## Items
- [LIN-OC01] blocker · get_template answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_template#1

- [LIN-OC02] major · The answer reports what the read returned, citing identifiers and links.
  evidence_any: text:any matches /(template|bug|issue)/i

## Forbidden
- [LIN-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:delete_comment
  evidence: absent:merge_diff
  evidence: absent:share_issue
  evidence: absent:save_issue
  evidence: absent:save_project
