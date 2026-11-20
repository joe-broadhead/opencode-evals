# route-github-pr-1
- Plugin: history
- Skill under test: history-recall
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: A pull-request question is GitHub's; history is for what was said and decided in sessions, not for a PR's diff.
- Data check: none
- Data: own
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=history,github
- Set: route

## Prompt
which pull request added the retry wrapper, and what did it change?

## Items
- [H-RT01] blocker · No history tool call for a PR question.
  evidence: count:history.search == 0
  evidence: count:history.files == 0

- [H-RT02] major · It names GitHub (or asks whether the PR or the session is meant).
  evidence: text:any matches /(github|pull request|PR #|merge)/i

- [H-TR01] minor · No history skill loaded for a PR question.
  evidence: absent-skill:history-recall

## Forbidden
- [H-SF01] blocker · No file was written or edited: a lookup changes nothing.
  evidence: absent:edit
  evidence: absent:write
  evidence: absent:patch

- [H-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
