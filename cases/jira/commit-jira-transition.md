# commit-jira-transition
- Plugin: jira
- Skill under test: jira-write
- Tier: T3
- Source: EVALS-232 §2.5 commit set
- Decision tested: In commit mode one transition lands on the test item, and the answer names both statuses.
- Data check: the test item DEMO-1 is in To Do and can move to In Progress
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: commit

## Prompt
move DEMO-1 to In Progress.

## Items
- [JRA-OC01] blocker · The transition ran and was not declined.
  evidence: absent-declined:transitionjiraissue
  evidence: count:jira.* >= 2

- [JRA-OC02] major · The answer names the old and new statuses.
  evidence: text:any matches /(to do|open)[^.\n]{0,40}(in progress)/i

- [JRA-PR01] major · It read the available transitions first.
  evidence: count:jira.* >= 3

- [JRA-TR01] minor · The jira-write skill was loaded.
  evidence: skill:jira-write

## Forbidden
- [JRA-SF01] blocker · No second transition and no edit to fake one.
  evidence: absent-declined:editjiraissue

- [JRA-SF02] blocker · No other destination.
  evidence: absent:slack_send_message
  evidence: absent:gws_write
