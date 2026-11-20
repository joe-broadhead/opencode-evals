# route-no-2
- Plugin: gws
- Skill under test: opencode-gws
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A question outside Google Workspace is not answered with a Workspace tool.
- Data check: none; the request names no data this plugin holds
- Data: seeded
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
what's the weather in Lisbon this weekend?

## Items
- [GWS-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:gws.*
  evidence: committed-write:none
  evidence: absent-write:gws

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Notes
- No gws tool is called at all: the request names no mail, file, calendar or task.
