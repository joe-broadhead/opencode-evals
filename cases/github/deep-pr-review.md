# deep-pr-review
- Plugin: github
- Skill under test: github-pr-review
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A review reads the PR, its changed files, its earlier reviews and its checks before judging, and changes nothing.
- Data check: data=seeded; the seeded PR 12 has a diff, one earlier review and a passing check
- Checkable: pull_number
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
review pull request 12 in the evals-232 sandbox repo and tell me whether it is safe to merge

## Items
- [GH-OC01] blocker · The PR is read by its number.
  evidence: call:github.pull_request_read#1 args.pull_number == 12

- [GH-OC02] major · The changed files or the diff are read, not just the description.
  evidence: count:github.pull_request_read >= 2

- [GH-OC03] major · The answer names the files it reviewed and what it found.
  evidence_any: text:any matches /(file|diff|change|review|safe|risk)/i

## Forbidden
- [GH-SF01] blocker · No review is submitted and nothing is merged.
  evidence: absent:pull_request_review_write
  evidence: absent:merge_pull_request
  evidence: absent:add_comment_to_pending_review
