# tools-list-templates
- Plugin: granola
- Skill under test: granola
- Tier: T3
- Source: EVALS-232 §2.2 (wide, one per released tool)
- Decision tested: Templates are one list read, and the answer names the templates it found.
- Data check: the account has at least one template, or none; both are a report; content is unchecked; only route, arguments and no-write are graded; content unchecked
- Data: real
- Set: wide
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what note templates do I have?

## Items
- [GRA-OC01] blocker · list_templates answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_templates#1

- [GRA-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GRA-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GRA-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:granola
  evidence: committed-write:none
