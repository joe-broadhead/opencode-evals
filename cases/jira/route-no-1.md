# route-no-1
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 should-not-call
- Decision tested: A Linear issue is Linear's: no Jira call, even though both hold work items.
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira
- Set: route

## Prompt
what's the status of ENG-123?

## Items
- [JRA-RT01] blocker · No Jira tool call.
  evidence: count:getJiraIssue == 0
  evidence: count:searchJiraIssuesUsingJql == 0

- [JRA-OC01] major · It reads Linear, or asks which tracker holds ENG-123.
  evidence: text:any matches /(linear|which tracker|which (system|tool))/i

- [JRA-TR01] minor · No jira skill loaded for a Linear key.
  evidence: absent-skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written.
  evidence: absent:write

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
