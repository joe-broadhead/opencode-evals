# tools-agents-list-conversations
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_list_conversations (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_list_conversations reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
list the last ten calls.

## Items
- [ELV-OC01] blocker · It read it with agents_list_conversations once.
  evidence: count:elevenlabs.agents_list_conversations == 1
- [ELV-OC02] major · The answer lists the calls with dates.
  evidence: text:any matches /(call|conversation|2026-|none)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
