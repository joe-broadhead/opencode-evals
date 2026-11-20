# tools-content-format-guide
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 wide: one request per tool (fake mode)
- Decision tested: Jira's own authoring guidance is read with getContentFormatGuide rather than guessed.
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide

## Prompt
what formatting does Jira accept in a comment description? I want to write one that renders.

## Items
- [JRA-OC01] blocker · The read ran once, with getContentFormatGuide.
  evidence: count:getContentFormatGuide == 1

- [JRA-OC02] blocker · The answer states what the fixture holds.
  evidence: text:any matches /(no (guidance|format)|nothing|couldn't|could not|not available)/i

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written: this is a read.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
