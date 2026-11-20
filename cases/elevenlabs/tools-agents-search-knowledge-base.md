# tools-agents-search-knowledge-base
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_search_knowledge_base (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_search_knowledge_base reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
search the knowledge base for our refund policy.

## Items
- [ELV-OC01] blocker · It read it with agents_search_knowledge_base once.
  evidence: count:elevenlabs.agents_search_knowledge_base == 1
- [ELV-PR01] major · It passed the query the question needs.
  evidence: call:elevenlabs.agents_search_knowledge_base#1 args.query present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
