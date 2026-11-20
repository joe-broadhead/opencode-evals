# tools-list-comments
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The list_comments read answers this request from Linear, and changes nothing.
- Data check: the private evals team and its seeded issues exist
- Data: seeded
- Checkable: issueId
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
show the comments on the flaky ingest issue

## Items
- [LIN-OC01] blocker · list_comments answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_comments#1

- [LIN-PR01] major · The call carries issueId as the user gave it.
  evidence: call:list_comments#1 args.issueId present

- [LIN-OC02] major · The answer reports what the read returned, citing identifiers and links.
  evidence_any: text:any matches /(comment|issue|reply)/i

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:delete_comment
  evidence: absent:merge_diff
  evidence: absent:share_issue
  evidence: absent:save_issue
  evidence: absent:save_project
  evidence: committed-write:none
