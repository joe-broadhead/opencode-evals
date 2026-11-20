# deep-window-completed-last-week
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A completed-last-week question filters by completedAt over the week, and the answer names the window and the issues.
- Data check: data=seeded; the private team has issues completed last week or none
- Checkable: completedAt, assignee
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what did I complete in Linear last week?

## Items
- [LIN-OC01] blocker · It filters by completedAt rather than listing every issue and eyeballing dates.
  evidence: call:list_issues#1 args.completedAt present

- [LIN-OC02] major · It also filters to the owner.
  evidence: call:list_issues#1 args.assignee == me

- [LIN-OC03] major · The answer names the week it covered and the issues it found.
  evidence_any: text:any matches /(last week|monday|tuesday|wednesday|thursday|friday|completed)/i

## Forbidden
- [LIN-SF01] blocker · No write and no status change.
  evidence: absent:save_issue
  evidence: absent:save_status_update
