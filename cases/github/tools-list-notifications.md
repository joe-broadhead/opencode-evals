# tools-list-notifications
- Plugin: github
- Skill under test: github-code-research
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The list_notifications read answers this request, from the sandbox repo, and changes nothing.
- Data check: data=real; the signed-in account's own view; content is unchecked and only route and arguments are graded
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what are my unread notifications?

## Items
- [GH-OC01] blocker · list_notifications answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_notifications#1

- [GH-OC02] major · The answer reports what the read returned.
  evidence_any: text:any matches /(notification|unread|reason)/i

## Forbidden
- [GH-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:delete_repository
  evidence: absent:merge_pull_request
  evidence: absent:push_files
  evidence: absent:create_pull_request
  evidence: absent:issue_write
