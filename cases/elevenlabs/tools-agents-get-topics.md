# tools-agents-get-topics
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_get_topics (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_topics reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what topics came up in calls this week?

## Items
- [ELV-OC01] blocker · It read it with agents_get_topics once.
  evidence: count:elevenlabs.agents_get_topics == 1
- [ELV-PR01] major · It passed the agent id the question needs.
  evidence: call:elevenlabs.agents_get_topics#1 args.agent_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
