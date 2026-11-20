# tools-agents-resolve-conversation
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_resolve_conversation (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_resolve_conversation reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
here's the dashboard link for that call — which conversation is it?

## Items
- [ELV-OC01] blocker · It read it with agents_resolve_conversation once.
  evidence: count:elevenlabs.agents_resolve_conversation == 1
- [ELV-PR01] major · It passed the agent id the question needs.
  evidence: call:elevenlabs.agents_resolve_conversation#1 args.agent_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
