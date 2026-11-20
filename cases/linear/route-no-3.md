# route-no-3
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local file is read with the local tools, not turned into Linear issues.
- Data check: the credential-free local arm has TODO.md in the working directory; content unchecked
- Data: seeded
- Set: route, local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
read the TODO.md in my repo and turn it into a plan

## Items
- [LIN-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: committed-write:none
  evidence: absent-write:linear

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
