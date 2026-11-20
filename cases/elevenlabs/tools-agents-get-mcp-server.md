# tools-agents-get-mcp-server
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_mcp_server (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_mcp_server reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the config of MCP server mcp_000000000000000000000000 for {{target:elevenlabs.agent}}.

## Items
- [ELV-TR01] blocker · It read it with agents_get_mcp_server once.
  evidence: call:elevenlabs.agents_get_mcp_server#1
- [ELV-PR01] major · It passed the mcp server id the question needs.
  evidence: call:elevenlabs.agents_get_mcp_server#1 args.mcp_server_id present
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none
- [ELV-OC09] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (conversation|flow|test|run|ticket|document|procedure|branch|generation|voice|item|folder|merge proposal|batch|caller|tool|connection|alert|result|node|view state))/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
