# tools-events-list
- Plugin: github
- Skill under test: github-code-research
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The events_list read answers this request, from the sandbox repo, and changes nothing.
- Data check: data=seeded; the sandbox repo holds the seeded record this read needs
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
for the activity collector: list what I was involved in on GitHub since its last cursor

## Items
- [GH-OC01] blocker · events_list answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:events_list#1

- [GH-OC02] major · The answer reports what the read returned.
  evidence_any: text:any matches /(event|since|cursor|issue)/i

## Forbidden
- [GH-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:delete_repository
  evidence: absent:merge_pull_request
  evidence: absent:push_files
  evidence: absent:create_pull_request
  evidence: absent:issue_write
