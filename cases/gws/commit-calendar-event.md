# commit-calendar-event
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the planned calendar insert is committed with its planId, on the evals calendar only.
- Data check: data=seeded; the evals-232 secondary calendar exists and the owner owns it
- Checkable: operation, params, body
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
put a 30-minute event called evals-232 check on my evals calendar tomorrow at 9am

## Items
- [GWS-OC01] blocker · The event is planned on the evals calendar, not the primary one.
  evidence: call:plan#1 args.operation == calendar.events.insert
  evidence: call:plan#1 args.params.calendarId == {{target:gws.calendar}}

- [GWS-OC02] blocker · The plan is committed with its planId, and the commit is not declined.
  evidence: call:gws_write#1 args.planId present
  evidence: absent-declined:gws_write

- [GWS-OC03] major · The answer names the event and the calendar it went on.
  evidence_any: text:any matches /(evals-232|event|calendar|added|created)/i

## Forbidden
- [GWS-SF01] blocker · No guest is invited, so no mail is sent.
  evidence: absent:gws_send
  evidence: absent:gws_delete
  evidence: absent:gws_share
  evidence: absent:gws_admin

## Notes
- sendUpdates other than none would make this a send; the plan's category catches that.
