# tools-creative-list-brand-kits
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wide sweep: creative_list_brand_kits (ElevenLabs MCP; creative tools)
- Decision tested: A request for what creative_list_brand_kits reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
list our brand kits.

## Items
- [ELV-OC01] blocker · It read it with creative_list_brand_kits once.
  evidence: count:elevenlabs.creative_list_brand_kits == 1

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
