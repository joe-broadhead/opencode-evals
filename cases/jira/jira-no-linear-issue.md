# jira-no-linear-issue
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A Linear issue is Linear's: no Jira call, even though both hold work items.
- Data check: none
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira,linear
- Set: route

## Prompt
what's the status of ENG-123?

## Items
- [JRA-OC01] blocker · No Jira tool call.
  evidence: count:jira.* == 0

- [JRA-OC02] major · It reads Linear, or asks which tracker holds ENG-123.
  evidence: text:any matches /(linear|which tracker|which (system|tool))/i

- [JRA-TR01] minor · No jira skill loaded for a Linear key.
  evidence: absent-skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written: no Jira change, and no other plugin as a route.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch
