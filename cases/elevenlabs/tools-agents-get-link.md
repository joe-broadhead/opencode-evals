# tools-agents-get-link
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_link (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_link reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
give me the shareable link to {{target:elevenlabs.agent}}.

## Items
- [ELV-OC01] blocker · It read it with agents_get_link once.
  evidence: count:elevenlabs.agents_get_link == 1
- [ELV-PR01] major · It passed the agent id the question needs.
  evidence: call:elevenlabs.agents_get_link#1 args.agent_id present
- [ELV-OC03] major · The answer gives the link.
  evidence: text:any matches /(https?:|link|elevenlabs)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
