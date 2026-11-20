# route-issue-1
- Plugin: github
- Skill under test: github-issue-triage
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A GitHub issue is read from GitHub, not from Linear or Jira.
- Data check: the harness's fake GitHub holds the quill-notes fixture; content unchecked
- Data: synthetic
- Seed: plugins=linear,jira
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's the status of issue 1 in the quill-notes repo?

## Items
- [GH-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:github.issue_read#1

- [GH-RT02] major · The overlapping plugin is not called.
  evidence: absent:linear.*
  evidence: absent:jira.*

- [GH-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GH-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GH-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
  evidence: absent-write:github
