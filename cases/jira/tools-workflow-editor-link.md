# tools-workflow-editor-link
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 wide: one request per tool (fake mode)
- Decision tested: The workflow editor link comes from getJiraWorkflowEditorLink.
- Data check: the fake Jira fixture: site quill-labs.invalid, project QLN with QLN-1 to QLN-7
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide

## Prompt
give me the link to edit the workflow for QLN.

## Items
- [JRA-OC01] blocker · The read ran once, with getJiraWorkflowEditorLink.
  evidence: count:getJiraWorkflowEditorLink == 1

- [JRA-OC02] blocker · The answer states what the fixture holds.
  evidence: text:any matches /(no (link|workflow)|nothing|couldn't|could not|not available)/i

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
