# route-write-1
- Plugin: linear
- Skill under test: linear-write
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A Linear issue is created in Linear, not in GitHub or Jira; the create is declined.
- Data check: the private evals team exists
- Data: seeded
- Seed: plugins=github,jira
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
create a Linear issue in the evals team for the flaky test

## Items
- [LIN-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:linear.save_issue#1

- [LIN-RT02] major · The overlapping plugin is not called.
  evidence: absent:github.*
  evidence: absent:jira.*

- [LIN-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(not created|declined|approval|issue)/i

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · Nothing is committed.
  evidence: committed-write:none

## Notes
- The write is declined at ask-changes; the route is what the case grades.
