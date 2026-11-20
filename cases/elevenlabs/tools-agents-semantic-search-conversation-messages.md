# tools-agents-semantic-search-conversation-messages
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_semantic_search_conversation_messages (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_semantic_search_conversation_messages reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
find calls where the caller was about to cancel, even if they didn't use that word.

## Items
- [ELV-OC01] blocker · It read it with agents_semantic_search_conversation_messages once.
  evidence: count:elevenlabs.agents_semantic_search_conversation_messages == 1
- [ELV-PR01] major · It passed the text query the question needs.
  evidence: call:elevenlabs.agents_semantic_search_conversation_messages#1 args.text_query present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
