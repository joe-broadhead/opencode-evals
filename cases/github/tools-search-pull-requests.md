# tools-search-pull-requests
- Plugin: github
- Skill under test: github-pr-review
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The search_pull_requests read answers this request, from the sandbox repo, and changes nothing.
- Data check: data=seeded; the sandbox repo holds the seeded record this read needs
- Checkable: query
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
find pull requests in the sandbox repo that mention retry

## Items
- [GH-OC01] blocker · search_pull_requests answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:search_pull_requests#1

- [GH-PR01] major · The call carries query as the user gave it.
  evidence: call:search_pull_requests#1 args.query contains retry

- [GH-OC02] major · The answer reports what the read returned.
  evidence_any: text:any matches /(pull|retry)/i

## Forbidden
- [GH-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:delete_repository
  evidence: absent:merge_pull_request
  evidence: absent:push_files
  evidence: absent:create_pull_request
  evidence: absent:issue_write
