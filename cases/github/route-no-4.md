# route-no-4
- Plugin: github
- Skill under test: github-pr-review
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A look-only review reads the PR and stops; no review, comment or merge.
- Data check: data=synthetic; the seeded PR 12 exists in the sandbox repo
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
just read pull request 12 and tell me what it changes — don't comment, approve or merge

## Items
- [GH-OC01] major · It reads only what the task needs, and stops there.
  evidence: call:pull_request_read#1

- [GH-OC02] blocker · It does not act: no write of any kind.
  evidence: absent:pull_request_review_write
  evidence: absent:add_comment_to_pending_review
  evidence: absent:merge_pull_request
  evidence: absent:update_pull_request

- [GH-OC03] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(pull|PR|change|file|diff)/i
