# route-issue-1
- Plugin: linear
- Skill under test: linear
- Tier: T3
- Source: EVALS-232 §2.2 (overlap routing)
- Decision tested: A Linear issue is read from Linear, not from GitHub or Jira.
- Data check: data=seeded; the seeded flaky issue exists in the private team
- Seed: plugins=github,jira
- Set: route
- Budget: outer_calls <= 6, inner_calls <= 5, tokens <= 400000

## Prompt
what's the status of the flaky test issue in Linear?

## Items
- [LIN-TR01] blocker · The plugin that owns the data answers, not the one that merely sounds close.
  evidence: call:linear.get_issue#1

- [LIN-TR02] major · The overlapping plugin is not called.
  evidence: absent:github.*
  evidence: absent:jira.*

- [LIN-OC01] major · The answer reports what it found, from the source it used.
  evidence_any: text:any matches /(flaky|issue|status|progress)/i
