# tools-read
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: An inbox question is one gws read of the Gmail list operation, and the answer reports what it found.
- Data check: the inbox holds at least one unread message or none; either is a report; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Checkable: operation
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
list the unread messages in my inbox

## Items
- [GWS-OC01] blocker · gws.read answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:gws.read#1

- [GWS-PR01] major · The call carries operation as the user gave it.
  evidence: call:gws.read#1 args.operation == gmail.users.messages.list

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GWS-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:gws
  evidence: committed-write:none
