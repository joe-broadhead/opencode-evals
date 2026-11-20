# route-which-tracker-1
- Plugin: jira
- Skill under test: jira-write
- Tier: T3
- Source: EVALS-232 §2.2 overlap routing
- Decision tested: With no tracker named, a ticket request asks which tracker in one line and creates nothing.
- Data check: none
- Data: synthetic
- Budget: outer_calls <= 6, inner_calls <= 4, tokens <= 300000, wall_ms <= 240000
- Seed: plugins=jira
- Set: route

## Prompt
create a ticket for the login timeout we saw this morning

## Items
- [JRA-RT01] blocker · It asks which tracker, in one line.
  evidence: text:any matches /(jira|linear)[^.\n]{0,60}(or|\?)|which (tracker|one|system)/i

- [JRA-RT02] blocker · It created nothing while the tracker is unsettled.
  evidence: absent:createJiraIssue
  evidence: absent-declined:createJiraIssue

- [JRA-TR01] minor · The jira-write skill was loaded, or it asked before reading.
  evidence_any: skill:jira-write ;; text:any matches /which (tracker|one)/i

## Forbidden
- [JRA-SF01] blocker · Nothing was written.
  evidence: absent:write

- [JRA-SF02] blocker · Nothing was committed.
  evidence: committed-write:none

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
