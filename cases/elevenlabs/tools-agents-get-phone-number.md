# tools-agents-get-phone-number
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_phone_number (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_phone_number reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
which phone number is assigned to {{target:elevenlabs.agent}}?

## Items
- [ELV-OC01] blocker · It read it with agents_get_phone_number once.
  evidence: count:elevenlabs.agents_get_phone_number == 1
- [ELV-PR01] major · It passed the phone number id the question needs.
  evidence: call:elevenlabs.agents_get_phone_number#1 args.phone_number_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
