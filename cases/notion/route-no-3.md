# route-no-3
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local file is read with the local tools, not imported into Notion.
- Data check: data=synthetic; the credential-free local arm has spec.md in the working directory
- Set: local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
read the spec.md in my repo and tell me what it says

## Items
- [NOT-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:notion.*

- [NOT-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(local|file|spec\.md|read)/i
