# tools-content-format-guide-p
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-content-format-guide (lane L6b)
- Decision tested: Jira's own authoring guidance is read with getContentFormatGuide rather than guessed.
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide, twin

## Prompt
how do I mark up text in a Jira comment or description so it comes out styled properly?

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
  evidence: absent-write:jira

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
