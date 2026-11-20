# tools-creative-list-voices
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wide sweep: creative_list_voices (ElevenLabs MCP; creative tools)
- Decision tested: A request for what creative_list_voices reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
list the voices available in the workspace.

## Items
- [ELV-OC01] blocker · It read it with creative_list_voices once.
  evidence: count:elevenlabs.creative_list_voices == 1
- [ELV-OC02] major · The answer lists voices by name.
  evidence: text:any matches /(voice|none|no voices)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
