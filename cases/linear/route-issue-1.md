# route-issue-1
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A Linear issue is read from Linear, not from GitHub or Jira.
- Data check: the seeded flaky issue exists in the private team; content unchecked
- Data: seeded
- Seed: plugins=github,jira
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's the status of the issue {{canary:linear_issue}} in Linear?

## Items
- [LIN-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:linear.get_issue#1

- [LIN-RT02] major · The overlapping plugin is not called.
  evidence: absent:github.*
  evidence: absent:jira.*

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
  evidence: absent-write:linear
