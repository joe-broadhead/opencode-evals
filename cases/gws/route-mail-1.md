# route-mail-1
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: Mail goes through Gmail, not a Slack DM, a Notion comment or a file.
- Data check: the owner's address is the signed-in account; content unchecked
- Data: seeded
- Seed: plugins=slack+notion
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
email me the one-line summary we just agreed

## Items
- [GWS-RT01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:gws.plan#1

- [GWS-RT02] major · The overlapping plugin is not called.
  evidence: absent:slack.*
  evidence: absent:notion.*

- [GWS-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GWS-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [GWS-SF01] blocker · Nothing is committed.
  evidence: committed-write:none
  evidence: absent-write:gws

## Notes
- The plan is the gws route; the commit is declined, which the answer must say.
