# route-no-3
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local file is read with the local tools, not imported into Notion.
- Data check: the credential-free local arm has spec.md in the working directory
- Data: seeded
- Set: route, local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
read the spec.md in my repo and tell me what it says

## Items
- [NOT-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:notion.*
  evidence: committed-write:none

- [NOT-OC01] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(local|file|spec\.md|read)/i

- [NOT-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [NOT-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
