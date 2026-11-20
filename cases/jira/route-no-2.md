# route-no-2
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A pull request is GitHub's: a Jira item that links one stays Jira, but a PR question is not a Jira search.
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira
- Set: route

## Prompt
what did the last merged pull request change in the auth module?

## Items
- [JRA-RT01] blocker · No Jira tool call.
  evidence: absent:jira.*

- [JRA-RT03] major · It read GitHub, or asks whether the PR or the issue is meant.
  evidence_any: count:github.* >= 1 ;; text:any matches /(which (one|do you mean)|the PR or the issue)/i

- [JRA-TR01] minor · No jira skill loaded for a PR question.
  evidence: absent-skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written.
  evidence: absent:write
  evidence: absent-write:jira

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
