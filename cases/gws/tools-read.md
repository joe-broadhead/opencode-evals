# tools-read
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: An inbox question is one gws read of the Gmail list operation, and the answer reports what it found.
- Data check: data=seeded; the inbox holds at least one unread message or none; either is a report
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

- [GWS-OC02] major · The answer reports the unread mail it found, or says there is none.
  evidence_any: text:any matches /(unread|inbox|no unread|nothing unread)/i

## Forbidden
- [GWS-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent:gws.write
  evidence: absent:send
  evidence: absent:delete
  evidence: absent:share
  evidence: absent:export
  evidence: absent:admin
