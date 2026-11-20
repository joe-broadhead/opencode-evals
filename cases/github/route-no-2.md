# route-no-2
- Plugin: github
- Skill under test: github-code-research
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A calendar question is not answered with a GitHub tool.
- Data check: data=synthetic; none; the request names no data this plugin holds
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
what's on my calendar tomorrow?

## Items
- [GH-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:github.*

- [GH-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(calendar|not (something )?I can|cannot|can't|unable|not available)/i
