# tools-agents-read-string-field
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_read_string_field (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_read_string_field reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
read me {{target:elevenlabs.agent}}'s system prompt field.

## Items
- [ELV-TR01] blocker · It read it with agents_read_string_field once.
  evidence: call:elevenlabs.agents_read_string_field#1
- [ELV-PR01] major · It passed the target the question needs.
  evidence: call:elevenlabs.agents_read_string_field#1 args.target present
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
