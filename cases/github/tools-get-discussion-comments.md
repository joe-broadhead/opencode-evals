# tools-get-discussion-comments
- Plugin: github
- Skill under test: github-issue-triage
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The get_discussion_comments read answers this request, from the sandbox repo, and changes nothing.
- Data check: data=seeded; the sandbox repo holds the seeded record this read needs
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
show the comments on discussion 5 in the sandbox repo

## Items
- [GH-OC01] blocker · get_discussion_comments answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_discussion_comments#1

- [GH-OC02] major · The answer reports what the read returned.
  evidence_any: text:any matches /(comment|discussion|reply)/i

## Forbidden
- [GH-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:delete_repository
  evidence: absent:merge_pull_request
  evidence: absent:push_files
  evidence: absent:create_pull_request
  evidence: absent:issue_write
