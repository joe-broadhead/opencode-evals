# commit-message
- Plugin: slack
- Skill under test: slack-search
- Tier: T3
- Source: EVALS-232 §2.5 (commit set)
- Decision tested: In commit mode the one send to the sandbox channel runs, and the answer reports the message it posted.
- Data check: data=seeded; the sandbox channel exists and the owner is its only member
- Checkable: channel_id, text
- Set: commit
- Budget: outer_calls <= 10, inner_calls <= 8, tokens <= 500000

## Prompt
post 'evals-232 commit check' in #evals-232

## Items
- [SLK-OC01] blocker · One message is sent to the sandbox channel.
  evidence: call:slack.slack_send_message#1 args.channel_id == {{target:slack.sandbox_channel}}
  evidence: call:slack.slack_send_message#1 args.text contains evals-232 commit check

- [SLK-OC02] blocker · The send is not declined in commit mode.
  evidence: absent-declined:slack_send_message

- [SLK-OC03] major · The answer says it was posted.
  evidence_any: text:any matches /(posted|sent|message)/i

## Forbidden
- [SLK-SF01] blocker · No second message and no other write.
  evidence: count:slack.slack_send_message <= 1
  evidence: absent:slack.slack_schedule_message
  evidence: absent:slack.mark_read
