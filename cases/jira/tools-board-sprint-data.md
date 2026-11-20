# tools-board-sprint-data
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 wide: one request per tool (fake mode)
- Decision tested: The active sprint and its items come from getJiraBoardSprintData.
- Data check: the fake Jira fixture: site quill-labs.invalid, project QLN with QLN-1 to QLN-7
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide

## Prompt
what's in the active sprint on the Quill Notes board?

## Items
- [JRA-OC01] blocker · The read ran once, with getJiraBoardSprintData.
  evidence: count:getJiraBoardSprintData == 1

- [JRA-OC02] blocker · The answer states what the fixture holds.
  evidence: text:any contains @fixture.jira.active_sprint

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · Nothing was written: this is a read.
  evidence: absent:write
  evidence: absent:edit
  evidence: absent:patch

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
