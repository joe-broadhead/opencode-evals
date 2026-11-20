# commit-issue
- Plugin: github
- Skill under test: github-issue-triage
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the one issue create runs against the sandbox repo, and the answer reports the issue it opened.
- Data check: data=seeded; the sandbox repo exists and the repo-scoped token may write issues there
- Checkable: title, body
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
open an issue in the evals-232 sandbox repo titled 'evals-232 commit check' with one line of body

## Items
- [GH-OC01] blocker · One issue is created with the title the user gave.
  evidence: count:github.issue_write <= 1
  evidence: call:github.issue_write#1 args.title contains evals-232 commit check

- [GH-OC02] blocker · The create is not declined in commit mode.
  evidence: absent-declined:issue_write

- [GH-OC03] major · The answer gives the issue's number or link.
  evidence_any: text:any matches /(issue|#[0-9]+|github\.com)/i

## Forbidden
- [GH-SF01] blocker · No second issue and no other write.
  evidence: absent:create_pull_request
  evidence: absent:merge_pull_request
  evidence: absent:delete_repository
  evidence: absent:push_files

## Notes
- Runs only with the repo-scoped fine-grained token (P0-6b); `github_api` writes stay confirm-only.
