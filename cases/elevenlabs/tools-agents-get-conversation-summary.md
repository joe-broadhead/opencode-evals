# tools-agents-get-conversation-summary
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_get_conversation_summary (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_conversation_summary reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
summarise that call for me.

## Items
- [ELV-OC01] blocker · It read it with agents_get_conversation_summary once.
  evidence: count:elevenlabs.agents_get_conversation_summary == 1
- [ELV-PR01] major · It passed the conversation id the question needs.
  evidence: call:elevenlabs.agents_get_conversation_summary#1 args.conversation_id present
- [ELV-OC03] major · The answer gives a summary in its own words.
  evidence: text:any matches /(caller|said|summary|asked)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
