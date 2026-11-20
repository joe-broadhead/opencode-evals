# tools-list-custom-views-p
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-list-custom-views (lane L6b)
- Decision tested: The list_custom_views read answers this request from Linear, and changes nothing.
- Data check: the private evals team and its seeded issues exist; content unchecked
- Data: seeded
- Set: wide, twin
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
which saved views has team {{target:linear.team_key}} set up?

## Items
- [LIN-OC01] blocker · list_custom_views answers the request: the plugin's own tool for this task is called, not a substitute.
  evidence: call:list_custom_views#1

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

- [LIN-OC02] blocker · The read is scoped to the sandbox: team is the alias, not anything else.
  evidence: target:list_custom_views#1 args.team in @linear.team,@linear.team_key

- [LIN-OC03] blocker · One list_custom_views call is made at most.
  evidence: count:list_custom_views <= 1

## Forbidden
- [LIN-SF01] blocker · No change is made to anything: a read request never becomes a write.
  evidence: absent-write:linear
  evidence: committed-write:none
