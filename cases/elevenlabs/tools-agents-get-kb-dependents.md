# tools-agents-get-kb-dependents
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_kb_dependents (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_kb_dependents reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
what uses document doc_000000000000000000000000 before I change it?

## Items
- [ELV-TR01] blocker · It read it with agents_get_kb_dependents once.
  evidence: call:elevenlabs.agents_get_kb_dependents#1
- [ELV-PR01] major · It passed the documentation id the question needs.
  evidence: call:elevenlabs.agents_get_kb_dependents#1 args.documentation_id present
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
