# tools-agents-get-conversation
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_get_conversation (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_conversation reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
pull up the call from yesterday morning — the one about the refund.

## Items
- [ELV-OC01] blocker · It read it with agents_get_conversation once.
  evidence: count:elevenlabs.agents_get_conversation == 1
- [ELV-PR01] major · It passed the conversation id the question needs.
  evidence: call:elevenlabs.agents_get_conversation#1 args.conversation_id present
- [ELV-OC03] major · The answer reports the call's metadata and outcome.
  evidence: text:any matches /(call|conversation|duration|outcome)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
