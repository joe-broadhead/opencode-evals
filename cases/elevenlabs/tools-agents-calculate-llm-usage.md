# tools-agents-calculate-llm-usage
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_calculate_llm_usage (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_calculate_llm_usage reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what would 10,000 agent calls a month cost us in LLM usage?

## Items
- [ELV-OC01] blocker · It read it with agents_calculate_llm_usage once.
  evidence: count:elevenlabs.agents_calculate_llm_usage == 1
- [ELV-PR01] major · It passed the agent id the question needs.
  evidence: call:elevenlabs.agents_calculate_llm_usage#1 args.agent_id present
- [ELV-OC03] major · The answer gives a cost or a usage estimate.
  evidence: text:any matches /(cost|\$|usage|token)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
