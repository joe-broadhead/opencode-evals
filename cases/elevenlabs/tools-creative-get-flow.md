# tools-creative-get-flow
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wide sweep: creative_get_flow (ElevenLabs MCP; creative tools)
- Decision tested: A request for what creative_get_flow reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me flow flow_000000000000000000000000.

## Items
- [ELV-TR01] blocker · It read it with creative_get_flow once.
  evidence: call:elevenlabs.creative_get_flow#1
- [ELV-PR01] major · It passed the flow id the question needs.
  evidence: call:elevenlabs.creative_get_flow#1 args.flow_id present
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
