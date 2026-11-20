# commit-calendar-event
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the planned calendar insert is committed with its planId, on the evals calendar only.
- Data check: the evals-232 secondary calendar exists and the owner owns it
- Data: seeded
- Checkable: operation, params, body
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
put a 30-minute event called evals-232 check on the calendar {{target:gws.calendar}} tomorrow at 9am

## Items
- [GWS-CT01] blocker · The event is planned as a calendar insert.
  evidence: gws-plan:#1 op == calendar.events.insert

- [GWS-CT02] blocker · The plan is committed with its planId, and the commit is not declined.
  evidence: call:gws_write#1 args.planId present
  evidence: absent-declined:gws_write

- [GWS-CT03] blocker · The write reaches only the sandbox target the user named.
  evidence: gws-plan:#1 target in @gws.calendar

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Notes
- sendUpdates other than none would make this a send; the plan's category catches that.
