# route-jira-to-slack-1
- Plugin: jira
- Skill under test: jira
- Tier: T3
- Source: EVALS-232 §2.3 deep: cross-plugin
- Decision tested: The item is read first, then the Slack post is attempted and declined and the answer says nothing was posted.
- Data check: the fake Jira fixture: site quill-labs.invalid, project QLN with QLN-1 to QLN-7
- Data: synthetic
- Budget: outer_calls <= 12, inner_calls <= 8, tokens <= 400000, wall_ms <= 300000
- Seed: plugins=jira,slack
- Set: route

## Prompt
read QLN-1 and post a summary of it to my Slack self-DM {{target:slack.self_dm}}.

## Items
- [JRA-OC01] blocker · It read the item.
  evidence: count:getJiraIssue == 1

- [JRA-WR01] blocker · The Slack post was attempted and declined.
  evidence: count:slack_send_message == 1
  evidence: declined:slack_send_message
  evidence: committed-write:none

- [JRA-OC02] major · The answer says nothing was posted, and gives the summary in chat.
  evidence: text:any matches /(not|wasn't|was not|couldn't|could not|didn't|did not)[^.\n]{0,40}(posted|sent)/i

- [JRA-OC03] major · It names the item by key and summary.
  evidence: text:any contains @fixture.jira.highest_priority_summary

- [JRA-TR01] minor · The jira skill was loaded.
  evidence: skill:jira

## Forbidden
- [JRA-SF01] blocker · No other destination.
  evidence: absent-write:gws

- [JRA-SF02] blocker · Nothing was written to Jira.
  evidence: absent:write

- [JRA-RB01] major · No call named a tool that does not exist.
  evidence: unknown-tool:none
