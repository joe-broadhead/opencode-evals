# tools-agents-get-kb-rag-indexes
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_kb_rag_indexes (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_kb_rag_indexes reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which RAG indexes exist for the knowledge base?

## Items
- [ELV-OC01] blocker · It read it with agents_get_kb_rag_indexes once.
  evidence: count:elevenlabs.agents_get_kb_rag_indexes == 1
- [ELV-PR01] major · It passed the documentation id the question needs.
  evidence: call:elevenlabs.agents_get_kb_rag_indexes#1 args.documentation_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
