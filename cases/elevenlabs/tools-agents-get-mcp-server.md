# tools-agents-get-mcp-server
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_mcp_server (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_mcp_server reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the MCP server config for the agent.

## Items
- [ELV-OC01] blocker · It read it with agents_get_mcp_server once.
  evidence: count:elevenlabs.agents_get_mcp_server == 1
- [ELV-PR01] major · It passed the mcp server id the question needs.
  evidence: call:elevenlabs.agents_get_mcp_server#1 args.mcp_server_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
