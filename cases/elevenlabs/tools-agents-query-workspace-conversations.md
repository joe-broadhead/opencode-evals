# tools-agents-query-workspace-conversations
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_query_workspace_conversations (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_query_workspace_conversations reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
search all our conversations for anyone asking about refunds.

## Items
- [ELV-OC01] blocker · It read it with agents_query_workspace_conversations once.
  evidence: count:elevenlabs.agents_query_workspace_conversations == 1
- [ELV-PR01] major · It passed the start unix secs the question needs.
  evidence: call:elevenlabs.agents_query_workspace_conversations#1 args.start_unix_secs present
- [ELV-OC03] major · The answer reports the matches, or that there are none.
  evidence: text:any matches /(refund|call|match|none)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
