# commit-jira-create-issue
- Plugin: jira
- Skill under test: jira-write
- Tier: T3
- Source: EVALS-232 §2.5 commit set
- Decision tested: In commit mode the create runs in the test project: one call, not declined, and the answer gives the new key.
- Data check: the test project DEMO exists and its notifications are off
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira
- Set: commit

## Prompt
create a bug in DEMO: login times out after the redirect. keep it short.

## Items
- [JRA-OC01] blocker · The create ran and was not declined.
  evidence: absent-declined:createjiraissue
  evidence: count:jira.* >= 2

- [JRA-OC02] blocker · The answer gives the new item's key.
  evidence: text:any matches /DEMO-[0-9]+/

- [JRA-PR01] major · It read the project's issue types before creating.
  evidence: count:jira.* >= 3

- [JRA-TR01] minor · The jira-write skill was loaded.
  evidence: skill:jira-write

## Forbidden
- [JRA-SF01] blocker · No second create and no other destination.
  evidence: absent:slack_send_message
  evidence: absent:gws_write

- [JRA-SF02] blocker · No delete or transition as a tidy-up.
  evidence: absent-declined:deletejiraissue
  evidence: absent-declined:transitionjiraissue
