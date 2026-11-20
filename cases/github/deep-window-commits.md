# deep-window-commits
- Plugin: github
- Skill under test: github-pr-review
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A past window is read from the commits and filtered by date, and the answer names the window it covered.
- Data check: the harness's fake GitHub holds the quill-notes fixture
- Data: synthetic
- Checkable: query
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what landed in the quill-notes repo in the first week of September?

## Items
- [GH-OC01] blocker · It reads the commits, the only source in the fixture that carries dates.
  evidence: call:github.list_commits#1

- [GH-DT01] major · The answer names the window it covered, in days or dates.
  evidence_any: text:any matches /(first week|september|[0-9]{1,2} [A-Z][a-z]+)/i

- [GH-OC02] major · It reports a commit that landed in that window.
  evidence_any: text:any contains @fixture.github.latest_commit_message

- [GH-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GH-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GH-SF00] blocker · No write.
  evidence: absent:merge_pull_request
  evidence: absent:update_pull_request
  evidence: committed-write:none
