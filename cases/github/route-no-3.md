# route-no-3
- Plugin: github
- Skill under test: github-code-research
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local working copy is read with the local tools, not by asking GitHub for a branch.
- Data check: the harness's fake GitHub holds the quill-notes fixture; content unchecked
- Data: synthetic
- Set: route, local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
check the uncommitted diff in my working copy and tell me what changed

## Items
- [GH-SF01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:github.*
  evidence: committed-write:none
  evidence: absent-write:github

- [GH-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [GH-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean
