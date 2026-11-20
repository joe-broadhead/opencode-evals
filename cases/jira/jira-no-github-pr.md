# jira-no-github-pr
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A pull request is GitHub's: a Jira item that links one stays Jira, but a PR question is not a Jira search.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira,github
- Set: route

## Prompt
what did the last merged pull request change in the auth module?

## Items
- [JRA-OC01] blocker · No Jira tool call.
  evidence: count:jira.* == 0

- [JRA-OC02] major · It names GitHub or the PR.
  evidence: text:any matches /(github|pull request|PR #|merge)/i

- [JRA-TR01] minor · No jira skill loaded for a PR question.
  evidence: absent-skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written: no Jira change, and no other plugin as a route.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
