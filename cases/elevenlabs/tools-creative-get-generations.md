# tools-creative-get-generations
- Plugin: elevenlabs
- Skill under test: elevenlabs-creative
- Tier: T3
- Source: wide sweep: creative_get_generations (ElevenLabs MCP; creative tools)
- Decision tested: A request for what creative_get_generations reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the generations from flow flow_000000000000000000000000.

## Items
- [ELV-TR01] blocker · It read it with creative_get_generations once.
  evidence: call:elevenlabs.creative_get_generations#1
- [ELV-PR01] major · It passed the flow id the question needs.
  evidence: call:elevenlabs.creative_get_generations#1 args.flow_id present
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none
- [ELV-OC09] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (conversation|flow|test|run|ticket|document|procedure|branch|generation|voice|item|folder|merge proposal|batch|caller|tool|connection|alert|result|node|view state))/i

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
