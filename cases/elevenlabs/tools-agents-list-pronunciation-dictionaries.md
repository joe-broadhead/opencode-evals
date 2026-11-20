# tools-agents-list-pronunciation-dictionaries
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_list_pronunciation_dictionaries (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_list_pronunciation_dictionaries reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
list our pronunciation dictionaries.

## Items
- [ELV-OC01] blocker · It read it with agents_list_pronunciation_dictionaries once.
  evidence: count:elevenlabs.agents_list_pronunciation_dictionaries == 1

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
