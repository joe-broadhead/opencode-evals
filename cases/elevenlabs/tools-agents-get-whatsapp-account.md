# tools-agents-get-whatsapp-account
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_whatsapp_account (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_whatsapp_account reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the WhatsApp account connected to the agent.

## Items
- [ELV-OC01] blocker · It read it with agents_get_whatsapp_account once.
  evidence: count:elevenlabs.agents_get_whatsapp_account == 1
- [ELV-PR01] major · It passed the phone number id the question needs.
  evidence: call:elevenlabs.agents_get_whatsapp_account#1 args.phone_number_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
