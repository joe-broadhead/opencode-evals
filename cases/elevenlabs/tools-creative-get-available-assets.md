# tools-creative-get-available-assets
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wide sweep: creative_get_available_assets (ElevenLabs MCP; creative tools)
- Decision tested: A request for what creative_get_available_assets reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what assets can I use in a flow?

## Items
- [ELV-OC01] blocker · It read it with creative_get_available_assets once.
  evidence: count:elevenlabs.creative_get_available_assets == 1

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
