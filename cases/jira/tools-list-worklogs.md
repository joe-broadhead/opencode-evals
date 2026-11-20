# tools-list-worklogs
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: Worklogs are summarised as a total and who logged them, not as every entry.
- Data check: the test project and its board, sprint and version exist on the evals Jira site
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide

## Prompt
how much time is logged on DEMO-1, and by whom?

## Items
- [JRA-OC01] blocker · Jira was read through the plugin.
  evidence: count:jira.* >= 1

- [JRA-OC02] major · The answer carries what this read returned.
  evidence: text:any matches /([0-9]+ ?(h|hours|m|minutes)|no time|nothing logged)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written: this is a read, and no other tool changes anything.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

## Notes
- Jira's tool names are camelCase, which the evidence grammar's tool clauses do not accept yet (see the lane report): this case grades the namespace and the answer, not the exact tool.
