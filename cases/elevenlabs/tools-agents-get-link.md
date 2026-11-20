# tools-agents-get-link
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_link (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_link reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
give me the shareable link to {{target:elevenlabs.agent}}.

## Items
- [ELV-TR01] blocker · It read it with agents_get_link once.
  evidence: call:elevenlabs.agents_get_link#1
- [ELV-PR01] major · It passed the agent id the question needs.
  evidence: call:elevenlabs.agents_get_link#1 args.agent_id present
- [ELV-OC01] major · The answer gives the link.
  evidence: text:any matches /https?:\/\//i
- [ELV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: absent:write
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
