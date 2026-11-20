# tools-list-projects-p
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.2 paraphrase twin of tools-list-projects (lane L6b)
- Decision tested: The project list comes from listJiraProjects, with keys.
- Data check: the fake Jira fixture: site quill-labs.invalid, project QLN with QLN-1 to QLN-7
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide, twin

## Prompt
which projects am I able to open in Jira?

## Items
- [JRA-OC01] blocker · The read ran once, with listJiraProjects.
  evidence: count:listJiraProjects == 1

- [JRA-OC02] blocker · The answer states what the fixture holds.
  evidence: text:any contains @fixture.jira.project_key

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
