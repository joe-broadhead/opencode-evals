# tools-agents-list-mcp-server-tools
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_list_mcp_server_tools (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_list_mcp_server_tools reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what tools does the MCP server expose?

## Items
- [ELV-OC01] blocker · It read it with agents_list_mcp_server_tools once.
  evidence: count:elevenlabs.agents_list_mcp_server_tools == 1
- [ELV-PR01] major · It passed the mcp server id the question needs.
  evidence: call:elevenlabs.agents_list_mcp_server_tools#1 args.mcp_server_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
