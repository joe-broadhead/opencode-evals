# tools-agents-search-procedures
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_search_procedures (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_search_procedures reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
search the procedures for escalation for {{target:elevenlabs.agent}}.

## Items
- [ELV-TR01] blocker · It read it with agents_search_procedures once.
  evidence: call:elevenlabs.agents_search_procedures#1
- [ELV-PR01] major · Aimed at the sandbox agent the user named, and nothing else.
  evidence: target:elevenlabs.agents_search_procedures#1 args.agent_id in @elevenlabs.agent
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
