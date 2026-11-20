# route-no-3
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local file is read with the local file tools, not by uploading it to Drive or guessing a Sheet.
- Data check: the credential-free local arm has a budget.csv in the working directory; content unchecked
- Data: seeded
- Set: route, local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
read the budget.csv on my Desktop and tell me the total

## Items
- [GWS-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: committed-write:none
  evidence: absent-write:gws

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Notes
- Runs in the credential-free local arm, where the shell and file tools exist.
