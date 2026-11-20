# tools-schema
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: A schema question is one schema call for the named operation, and the answer lists its parameters.
- Data check: the Calendar service is enabled
- Data: seeded
- Checkable: operation
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what parameters does the calendar events list operation take?

## Items
- [GWS-OC01] blocker · schema answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:schema#1

- [GWS-PR01] major · The call carries operation as the user gave it.
  evidence: call:schema#1 args.operation == calendar.events.list

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GWS-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:gws
  evidence: committed-write:none
  evidence: absent:gws.read
