# tools-creative-get-brand-kit
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wide sweep: creative_get_brand_kit (ElevenLabs MCP; creative tools)
- Decision tested: A request for what creative_get_brand_kit reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the brand kit.

## Items
- [ELV-OC01] blocker · It read it with creative_get_brand_kit once.
  evidence: count:elevenlabs.creative_get_brand_kit == 1
- [ELV-PR01] major · It passed the brand kit id the question needs.
  evidence: call:elevenlabs.creative_get_brand_kit#1 args.brand_kit_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
