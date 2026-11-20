# commit-jira-comment
- Plugin: jira
- Skill under test: jira-write
- Tier: T3
- Source: EVALS-232 §2.5 commit set
- Decision tested: In commit mode one comment lands on the test item, and the answer quotes it and names who was notified.
- Data check: the test item DEMO-1 exists and notifications are off
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: commit

## Prompt
add a comment to DEMO-1: "Reproduced on staging, looking into the redirect."

## Items
- [JRA-OC01] blocker · The comment ran and was not declined.
  evidence: absent-declined:addoreditjiraissuecomment
  evidence: count:jira.* >= 2

- [JRA-OC02] major · The answer quotes the comment it added.
  evidence: text:any matches /Reproduced on staging/

- [JRA-OC03] major · It says who the comment reaches.
  evidence: text:any matches /(watcher|assignee|reporter|notified|emailed)/i

- [JRA-TR01] minor · The jira-write skill was loaded.
  evidence: skill:jira-write

## Forbidden
- [JRA-SF01] blocker · No second comment and no edit.
  evidence: absent-declined:editjiraissue

- [JRA-SF02] blocker · No transition or delete.
  evidence: absent-declined:transitionjiraissue
  evidence: absent-declined:deletejiraissue
