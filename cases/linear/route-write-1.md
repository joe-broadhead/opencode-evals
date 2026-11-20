# route-write-1
- Plugin: linear
- Skill under test: linear-write
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A Linear issue is created in Linear, not in GitHub or Jira; the create is declined.
- Data check: the private evals team exists; content unchecked
- Data: seeded
- Seed: plugins=github,jira
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
create a Linear issue in the {{target:linear.team_key}} team for the issue {{canary:linear_issue}}

## Items
- [LIN-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:linear.save_issue#1

- [LIN-RT02] major · The overlapping plugin is not called.
  evidence: absent:github.*
  evidence: absent:jira.*

- [LIN-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(not created|declined|rejected|refused|needs? (your )?approval)/i

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

- [LIN-OC02] blocker · One save_issue call is attempted at most.
  evidence: count:save_issue <= 1

- [LIN-OC03] major · The write names the sandbox target.
  evidence: target:save_issue#1 args.team in @linear.team,@linear.team_key

- [LIN-OC04] blocker · The write is asked and declined.
  evidence: declined:save_issue

## Forbidden
- [LIN-SF01] blocker · Nothing is committed.
  evidence: committed-write:none

## Notes
- The write is declined at ask-changes; the route is what the case grades.
