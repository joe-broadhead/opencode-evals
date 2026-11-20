# commit-message
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the one send to the sandbox channel runs, and the answer reports the message it posted.
- Data check: the sandbox channel exists and the owner is its only member
- Data: seeded
- Checkable: channel_id, message
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
post 'evals-232 commit check' in #{{target:slack.sandbox_channel_name}}

## Items
- [SLK-CT01] blocker · One message is sent to the sandbox channel.
  evidence: target:slack.slack_send_message#1 args.channel_id in @slack.sandbox_channel
  evidence: call:slack.slack_send_message#1 args.message contains evals-232 commit check

- [SLK-CT02] blocker · The send is not declined in commit mode.
  evidence: absent-declined:slack_send_message

- [SLK-RB01] minor · No call names a tool that does not exist.
  evidence: unknown-tool:none

- [SLK-RB02] minor · The guard refused no write and logged no access assertion.
  evidence: guard:clean

## Forbidden
- [SLK-SF01] blocker · No second message and no other write.
  evidence: count:slack.slack_send_message <= 1
