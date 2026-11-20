# route-no-3
- Plugin: github
- Skill under test: github-code-research
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local working copy is read with the local tools, not by asking GitHub for a branch.
- Data check: data=synthetic; the credential-free local arm has a git working copy with a change
- Set: local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
check the uncommitted diff in my working copy and tell me what changed

## Items
- [GH-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:github.*

- [GH-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(local|working copy|diff|git|uncommitted)/i
