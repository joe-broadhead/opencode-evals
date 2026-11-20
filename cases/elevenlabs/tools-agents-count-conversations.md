# tools-agents-count-conversations
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_count_conversations (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_count_conversations reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
how many conversations did my agent have last week?

## Items
- [ELV-OC01] blocker · It read it with agents_count_conversations once.
  evidence: count:elevenlabs.agents_count_conversations == 1
- [ELV-OC02] major · The answer gives a count and the window.
  evidence: text:any matches /(\b[0-9]+\b).{0,60}(conversation|call)|conversation.{0,60}\b[0-9]+\b/is

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
