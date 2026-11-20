# deep-window-last-week
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.3 (deep)
- Decision tested: A relative past week is one events list bounded by the week's own instants, and the answer reports each day in the user's zone.
- Data check: the primary calendar holds last week's events, or none; both are a report
- Data: own
- Checkable: operation
- Set: deep
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
what was on my calendar last week?

## Items
- [GWS-OC01] blocker · The week is read with one events list.
  evidence: call:gws.read#1 args.operation == calendar.events.list

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

- [GWS-OC02] blocker · One gws read is made at most.
  evidence: count:gws.read <= 1

## Forbidden
- [GWS-SF01] blocker · No plan and no write for a read.
  evidence: absent-write:gws
  evidence: committed-write:none
  evidence: absent:gws.plan

## Notes
- The window is relative, so the case carries no absolute dates; the answer's own days are what is graded.
