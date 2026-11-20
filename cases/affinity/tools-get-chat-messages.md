# tools-get-chat-messages
- Plugin: affinity
- Skill under test: affinity
- Tier: T3
- Source: wave sweep: get_chat_messages (logged chat messages, dates and participants)
- Decision tested: A logged-chats question is one get_chat_messages for the window
- Seed: plugins=affinity
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the chat messages we logged this week.

## Items
- [AFF-TR01] blocker · It used get_chat_messages once.
  evidence: call:affinity.get_chat_messages#1
- [AFF-PR01] major · It bounded the window.
  evidence: call:affinity.get_chat_messages#1 args.filter_expr present
- [AFF-OC01] major · The answer lists the chats the tool returned, or says there are none, and quotes no more of a message than the question needs.
  grader: judge
- [AFF-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [AFF-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:affinity
  evidence: committed-write:none
- [AFF-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
