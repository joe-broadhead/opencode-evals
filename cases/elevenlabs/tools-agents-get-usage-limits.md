# tools-agents-get-usage-limits
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_usage_limits (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_usage_limits reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what are our usage limits on this plan?

## Items
- [ELV-OC01] blocker · It read it with agents_get_usage_limits once.
  evidence: count:elevenlabs.agents_get_usage_limits == 1

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
