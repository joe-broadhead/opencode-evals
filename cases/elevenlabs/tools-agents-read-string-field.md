# tools-agents-read-string-field
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_read_string_field (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_read_string_field reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
read me the agent's system prompt field.

## Items
- [ELV-OC01] blocker · It read it with agents_read_string_field once.
  evidence: count:elevenlabs.agents_read_string_field == 1
- [ELV-PR01] major · It passed the target the question needs.
  evidence: call:elevenlabs.agents_read_string_field#1 args.target present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
