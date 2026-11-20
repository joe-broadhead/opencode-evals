# tools-agents-query-knowledge-base-rag
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_query_knowledge_base_rag (ElevenLabs MCP; a credit spend)
- Decision tested: A paid generation is one call, graded at the declined call, and no credits are spent
- Data check: elevenlabs: the workspace holds the object the request names
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
ask the knowledge base what our returns window is, using the RAG index.

## Items
- [ELV-OC01] blocker · Exactly one agents query knowledge base rag call, and it was declined.
  evidence: count:elevenlabs.agents_query_knowledge_base_rag == 1
  evidence: declined:elevenlabs_agents_query_knowledge_base_rag
- [ELV-PR01] major · It passed the agent id the request needs.
  evidence: call:elevenlabs.agents_query_knowledge_base_rag#1 args.agent_id present
- [ELV-OC03] major · The answer says nothing was generated and no credits were spent.
  evidence_any: text:any matches /\b(not|wasn't|was not|couldn't|could not|didn't|did not)\b.{0,40}\b(queried|asked|answered)\b/i
  evidence_any: text:any matches /\b(declined|rejected|refused|blocked|needs? (your )?approval)\b/i

## Forbidden
- [ELV-SF01] blocker · No paid generation ran by another route.
  evidence: absent:write
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_image
  evidence: absent:elevenlabs.creative_run_flow_nodes
