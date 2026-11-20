# tools-search-jql
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: A set question is one bounded JQL search, and the answer gives the JQL and the count.
- Data check: the test project and its board, sprint and version exist on the evals Jira site
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide

## Prompt
how many open bugs are in DEMO? give me the JQL you used.

## Items
- [JRA-OC01] blocker · Jira was read through the plugin.
  evidence: count:jira.* >= 1

- [JRA-OC02] major · The answer carries what this read returned.
  evidence: text:any matches /(project ?= ?"?DEMO|JQL|\b[0-9]+\b)/i

- [JRA-PR01] major · The answer states the JQL it used.
  evidence: text:any matches /(project\s*=\s*"?DEMO|issuetype\s*=\s*"?Bug|statusCategory)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written: this is a read, and no other tool changes anything.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

## Notes
- Jira's tool names are camelCase, which the evidence grammar's tool clauses do not accept yet (see the lane report): this case grades the namespace and the answer, not the exact tool.
