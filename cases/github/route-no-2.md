# route-no-2
- Plugin: github
- Skill under test: github-code-research
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A calendar question is not answered with a GitHub tool.
- Data check: the harness's fake GitHub holds the quill-notes fixture
- Data: synthetic
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
what's on my calendar tomorrow?

## Items
- [GH-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:github.*
  evidence: committed-write:none

- [GH-OC01] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(calendar|not (something )?I can|cannot|can't|unable|not available)/i

- [GH-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GH-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
