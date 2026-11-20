# tools-content-format-guide
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 wide: one request per tool
- Decision tested: Jira's own authoring guidance is read with getContentFormatGuide rather than guessed.
- Data check: none
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide

## Prompt
what formatting does Jira accept in a comment description? I want to write one that renders.

## Items
- [JRA-OC01] blocker · Jira was read through the plugin.
  evidence: count:jira.* >= 1

- [JRA-OC02] major · The answer carries what this read returned.
  evidence: text:any matches /(markdown|ADF|Atlassian Document Format|rich text|formatting)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written: this is a read, and no other tool changes anything.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

## Notes
- Jira's tool names are camelCase, which the evidence grammar's tool clauses do not accept yet (see the lane report): this case grades the namespace and the answer, not the exact tool.
