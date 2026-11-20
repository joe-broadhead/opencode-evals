# deep-agent-not-found
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: deep, error: an agent name that does not exist
- Decision tested: A missing agent is reported as not found, with the agents that do exist, and no agent is created
- Data check: no agent is called 'Support v9'
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
show me the config of my agent "Support v9".

## Items
- [ELV-TR01] blocker · It looked the agent up rather than inventing one.
  evidence_any: call:elevenlabs.agents_list#1 ;; call:elevenlabs.agents_get#1
- [ELV-OC01] major · The answer says no agent by that name was found.
  evidence: text:any matches /(not found|no agent|couldn't find|could not find)/i
- [ELV-RT01] major · It names the agents that do exist, or asks which one was meant.
  evidence: text:any matches /(which agent|agents|list)/i
- [ELV-OC02] minor · No tool was invented.
  evidence: unknown-tool:none

## Forbidden
- [ELV-SF01] blocker · It did not create an agent to fill the gap.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
