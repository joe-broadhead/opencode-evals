# tools-agents-query-workspace-conversations
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_query_workspace_conversations (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_query_workspace_conversations reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: real
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
search all our conversations for anyone asking about refunds.

## Items
- [ELV-TR01] blocker · It read it with agents_query_workspace_conversations once.
  evidence: call:elevenlabs.agents_query_workspace_conversations#1
- [ELV-PR01] major · It passed the start unix secs the question needs.
  evidence: call:elevenlabs.agents_query_workspace_conversations#1 args.start_unix_secs present
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: absent:write
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
