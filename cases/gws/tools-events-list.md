# tools-events-list
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The collector's read is events_list, not a mailbox listing turned into events by hand.
- Data check: the account has received at least one message this week; content is unchecked; only route, arguments and no-write are graded; content unchecked
- Data: real
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
for the activity collector: give me the inbox messages that arrived since its last cursor, as events

## Items
- [GWS-OC01] blocker · events_list answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:events_list#1

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GWS-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:gws
  evidence: committed-write:none

## Notes
- events_list is the source contract's read for Memory's collector; it is not the tool for 'what is in my inbox'.
