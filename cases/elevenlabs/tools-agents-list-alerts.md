# tools-agents-list-alerts
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_list_alerts (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_list_alerts reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what alerts are set on my agents?

## Items
- [ELV-OC01] blocker · It read it with agents_list_alerts once.
  evidence: count:elevenlabs.agents_list_alerts == 1
- [ELV-PR01] major · It passed the from unix secs the question needs.
  evidence: call:elevenlabs.agents_list_alerts#1 args.from_unix_secs present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
