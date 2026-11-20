# tools-agents-get-draft
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wave sweep: agents_get_draft (the unpublished draft of an agent's branch)
- Decision tested: A what-would-publishing-change question reads the draft once, by agent id
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me the unpublished draft of {{target:elevenlabs.agent}} — what would publishing it change?

## Items
- [ELV-TR01] blocker · It used agents_get_draft once.
  evidence: call:elevenlabs.agents_get_draft#1
- [ELV-PR01] major · It read the draft of the sandbox agent.
  evidence: target:elevenlabs.agents_get_draft#1 args.agent_id in @elevenlabs.agent
- [ELV-OC01] major · The answer reports what the draft would change, or that nothing is staged.
  evidence: text:any matches /(draft|change|nothing|no draft|staged)/i
- [ELV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · No CRM write and no other source.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
