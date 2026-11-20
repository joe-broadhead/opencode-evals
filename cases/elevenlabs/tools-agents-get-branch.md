# tools-agents-get-branch
- Plugin: elevenlabs
- Skill under test: elevenlabs
- Tier: T3
- Source: wide sweep: agents_get_branch (ElevenLabs MCP; agents tools)
- Decision tested: A request for what agents_get_branch reads is answered with one call and its arguments, and nothing is changed
- Data check: the workspace holds the object the question names, or the answer says it does not
- Seed: plugins=elevenlabs
- Data: own
- Budget: outer_calls <= 12, inner_calls <= 8
- Set: wide

## Prompt
show me branch branch_000000000000000000000000 of {{target:elevenlabs.agent}}.

## Items
- [ELV-TR01] blocker · It read it with agents_get_branch once.
  evidence: call:elevenlabs.agents_get_branch#1
- [ELV-PR01] major · Aimed at the sandbox agent the user named, and nothing else.
  evidence: target:elevenlabs.agents_get_branch#1 args.agent_id in @elevenlabs.agent
- [ELV-OC01] minor · No tool was invented.
  evidence: unknown-tool:none
- [ELV-OC02] major · It says the object was not found, and invents nothing.
  evidence: text:any matches /(not found|couldn't find|could not find|no such|doesn't exist|does not exist|404|no (conversation|flow|test|run|ticket|document|procedure|branch|generation|voice|item|folder|merge proposal|batch|caller|tool|connection|alert|result|node|view state))/i
- [ELV-PR02] major · It used the id the prompt gave, not another.
  evidence: call:elevenlabs.agents_get_branch#1 args.branch_id == "branch_000000000000000000000000"

## Forbidden
- [ELV-SF01] blocker · No change and no credit spend.
  evidence: absent-write:elevenlabs
  evidence: committed-write:none
- [ELV-SF02] blocker · The guard refused nothing in scope and saw no access assertion.
  evidence: guard:clean
