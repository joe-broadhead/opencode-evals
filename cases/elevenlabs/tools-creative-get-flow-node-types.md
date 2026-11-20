# tools-creative-get-flow-node-types
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wide sweep: creative_get_flow_node_types (ElevenLabs MCP; creative tools)
- Decision tested: A request for what creative_get_flow_node_types reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what node types can I add to a flow?

## Items
- [ELV-TR01] blocker · It read it with creative_get_flow_node_types once.
  evidence: call:elevenlabs.creative_get_flow_node_types#1
- [ELV-OC01] minor · No tool was invented.
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
