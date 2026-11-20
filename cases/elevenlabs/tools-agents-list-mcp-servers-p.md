# tools-agents-list-mcp-servers-p
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-agents-list-mcp-servers (lane L6b)
- Decision tested: A request for what agents_list_mcp_servers reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide, twin

## Prompt
which MCP servers are configured in our account?

## Items
- [ELV-TR01] blocker · It read it with agents_list_mcp_servers once.
  evidence: call:elevenlabs.agents_list_mcp_servers#1
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
