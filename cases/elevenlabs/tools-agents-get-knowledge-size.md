# tools-agents-get-knowledge-size
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_knowledge_size (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_knowledge_size reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
how big is my knowledge base now?

## Items
- [ELV-OC01] blocker · It read it with agents_get_knowledge_size once.
  evidence: count:elevenlabs.agents_get_knowledge_size == 1
- [ELV-PR01] major · It passed the agent id the question needs.
  evidence: call:elevenlabs.agents_get_knowledge_size#1 args.agent_id present
- [ELV-OC03] major · The answer gives the size or document count.
  evidence: text:any matches /(size|document|\b[0-9]+\b)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
