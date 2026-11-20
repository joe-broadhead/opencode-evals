# tools-creative-get-flow-node-types
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wide sweep: creative_get_flow_node_types (ElevenLabs MCP; creative tools)
- Decision tested: A request for what creative_get_flow_node_types reads is answered with one call and its arguments, and nothing is changed
- Data check: elevenlabs: the workspace holds the object the question names, or the answer says it does not
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what node types can I add to a flow?

## Items
- [ELV-OC01] blocker · It read it with creative_get_flow_node_types once.
  evidence: count:elevenlabs.creative_get_flow_node_types == 1

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent:elevenlabs.agents_update
  evidence: absent:elevenlabs.agents_delete
  evidence: absent:write
