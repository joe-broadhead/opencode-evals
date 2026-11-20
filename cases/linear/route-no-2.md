# route-no-2
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: A pull request is GitHub's, not a Linear issue or document.
- Data check: data=synthetic; none; the request names no data this plugin holds
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
open a pull request that fixes the flaky test

## Items
- [LIN-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:linear.*

- [LIN-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(pull request|github|not (something )?I can|cannot|can't|unable|not available)/i
