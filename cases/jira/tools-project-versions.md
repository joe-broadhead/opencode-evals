# tools-project-versions
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 wide: one request per tool (fake mode)
- Decision tested: The version list comes from getJiraProjectVersions, with the unreleased one named.
- Data check: the fake Jira fixture: site quill-labs.invalid, project QLN with QLN-1 to QLN-7
- Data: synthetic
- Budget: outer_calls <= 8, inner_calls <= 6, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: wide

## Prompt
what versions does QLN have, and which one is unreleased?

## Items
- [JRA-OC01] blocker · The read ran once, with getJiraProjectVersions.
  evidence: count:getJiraProjectVersions == 1

- [JRA-OC02] blocker · The answer states what the fixture holds.
  evidence: text:any contains @fixture.jira.unreleased_version

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
