# tools-account-get-usage
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: account_get_usage (ElevenLabs MCP; agents tools)
- Decision tested: A request for what account_get_usage reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
how many characters of speech have we used this month, and what's left?

## Items
- [ELV-TR01] blocker · It read it with account_get_usage once.
  evidence: call:elevenlabs.account_get_usage#1
- [ELV-OC01] major · The answer gives the usage and the limit.
  evidence: text:any matches /(character|credit|used|limit|remaining)/i
- [ELV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:elevenlabs.creative_generate_speech
  evidence: absent:elevenlabs.creative_generate_video
  evidence: absent:write
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
