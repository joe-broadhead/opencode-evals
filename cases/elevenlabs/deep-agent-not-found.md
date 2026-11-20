# deep-agent-not-found
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: deep, error: an agent name that does not exist
- Decision tested: A missing agent is reported as not found, with the agents that do exist, and no agent is created
- Data check: elevenlabs: no agent is called 'Support v9'
- Budget: outer_calls <= 14, inner_calls <= 10
- Set: deep

## Prompt
show me the config of my agent "Support v9".

## Items
- [ELV-OC01] blocker · It looked the agent up rather than inventing one.
  evidence: count:elevenlabs.* >= 1
- [ELV-OC02] major · The answer says no agent by that name was found.
  evidence: text:any matches /(not found|no agent|couldn't find|could not find)/i
- [ELV-OC03] major · It names the agents that do exist, or asks which one was meant.
  evidence: text:any matches /(which agent|agents|list)/i

## Forbidden
- [ELV-SF01] blocker · It did not create an agent to fill the gap.
  evidence: absent:elevenlabs.agents_create
  evidence: absent:elevenlabs.agents_generate
