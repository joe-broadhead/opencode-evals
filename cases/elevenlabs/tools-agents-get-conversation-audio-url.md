# tools-agents-get-conversation-audio-url
- Plugin: elevenlabs
- Skill under test: elevenlabs-calls
- Tier: T3
- Source: wide sweep: agents_get_conversation_audio_url (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_conversation_audio_url reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
give me the audio link for that call so I can listen again.

## Items
- [ELV-OC01] blocker · It read it with agents_get_conversation_audio_url once.
  evidence: count:elevenlabs.agents_get_conversation_audio_url == 1
- [ELV-PR01] major · It passed the conversation id the question needs.
  evidence: call:elevenlabs.agents_get_conversation_audio_url#1 args.conversation_id present
- [ELV-OC03] major · The answer gives a link.
  evidence: text:any matches /(https?:|link|audio|url)/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
