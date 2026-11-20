# route-no-2
- Plugin: notion
- Skill under test: notion
- Tier: T3
- Source: EVALS-232 §2.2 (should-not-call)
- Decision tested: Mail is Gmail's, not a Notion comment or page edit.
- Data check: data=synthetic; none; the request names no data this plugin holds
- Set: route
- Budget: outer_calls <= 3, inner_calls <= 2, tokens <= 300000

## Prompt
send an email to the team saying the launch moved to Friday

## Items
- [NOT-OC01] blocker · It does not act: no tool of this plugin is called.
  evidence: absent:notion.*

- [NOT-OC02] major · The answer says what it did not do and why, or asks the one question that settles it.
  evidence_any: text:any matches /(email|mail|gmail|not (something )?I can|cannot|can't|unable|not available)/i
