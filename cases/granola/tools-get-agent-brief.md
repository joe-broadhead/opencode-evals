# tools-get-agent-brief
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: The user's own context is one brief read with the fields asked for, and it is background, not evidence of current work.
- Data check: the account has a role brief; content is unchecked; only route, arguments and no-write are graded
- Data: real
- Checkable: fields
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what do you know about my role and the team I work with?

## Items
- [GRA-OC01] blocker · get_agent_brief answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:get_agent_brief#1

- [GRA-PR01] major · The brief is asked for the fields the user named.
  evidence: call:get_agent_brief#1 args.fields contains role

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:granola
  evidence: committed-write:none
