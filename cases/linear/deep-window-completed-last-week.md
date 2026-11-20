# deep-window-completed-last-week
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A completed-last-week question filters by completedAt over the week, and the answer names the window and the issues.
- Data check: the private team has issues completed last week or none
- Data: seeded
- Checkable: completedAt, assignee
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what did I complete in Linear last week?

## Items
- [LIN-DT01] blocker · It filters by completedAt rather than listing every issue and eyeballing dates.
  evidence: call:list_issues#1 args.completedAt matches /^(-P[0-9]+[DWMY]|[0-9]{4}-[0-9]{2}-[0-9]{2})$/

- [LIN-PR01] major · It also filters to the owner.
  evidence: call:list_issues#1 args.assignee == me

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [LIN-SF01] blocker · No write and no status change.
  evidence: absent-write:linear
  evidence: committed-write:none
