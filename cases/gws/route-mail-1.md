# route-mail-1
- Plugin: gws
- Skill under test: opencode-gws-recipes
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: Mail goes through Gmail, not a Slack DM, a Notion comment or a file.
- Data check: data=seeded; the owner's address is the signed-in account
- Seed: plugins=slack+notion
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
email me the one-line summary we just agreed

## Items
- [GWS-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:gws.plan#1

- [GWS-TR02] major · The overlapping plugin is not called.
  evidence: absent:slack.*
  evidence: absent:notion.*

- [GWS-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(email|mail|draft|send|not sent|plan)/i

## Notes
- The plan is the gws route; the commit is declined, which the answer must say.
