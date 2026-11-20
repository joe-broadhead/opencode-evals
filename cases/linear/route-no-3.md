# route-no-3
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A local file is read with the local tools, not turned into Linear issues.
- Data check: data=synthetic; the credential-free local arm has TODO.md in the working directory
- Set: local
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
read the TODO.md in my repo and turn it into a plan

## Items
- [LIN-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:linear.*

- [LIN-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(local|file|todo\.md|read)/i
