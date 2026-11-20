# route-no-2
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A pull request is GitHub's, not a Linear issue or document.
- Data check: none; the request names no data this plugin holds
- Data: seeded
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
open a pull request that fixes the flaky test

## Items
- [LIN-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:linear.*
  evidence: committed-write:none
  evidence: absent-write:linear

- [LIN-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [LIN-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
