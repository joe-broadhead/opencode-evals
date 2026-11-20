# tools-agents-get-batch-call
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_batch_call (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_batch_call reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
how did the batch call finish — how many succeeded?

## Items
- [ELV-OC01] blocker · It read it with agents_get_batch_call once.
  evidence: count:elevenlabs.agents_get_batch_call == 1
- [ELV-PR01] major · It passed the batch id the question needs.
  evidence: call:elevenlabs.agents_get_batch_call#1 args.batch_id present

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
